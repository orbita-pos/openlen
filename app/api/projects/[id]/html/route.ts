import { and, desc, eq, isNull } from "drizzle-orm";
import { auth } from "@/auth";
import { actualizarData } from "@/lib/projects/escribir-data";
import { db, schema } from "@/lib/db";
import type { ProjectData } from "@/lib/projects/types";
import { validatePageSlug } from "@/lib/projects/site-pages";
import { createVersion } from "@/lib/projects/versions";
import { aplicarEdiciones, type Edicion } from "@/lib/page-engine/aplicar-ediciones";
import { MAX_HTML_BYTES } from "@/lib/projects/limites-html";
import { exigirAcceso } from "@/lib/projects/acceso";

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/projects/[id]/html — the editor's hand edits, applied to one of
// the project's documents: `data.html` (home) or, with `page`,
// `data.pages[slug].html`.
//
// Only EDITS travel — what changed, never the document. That is Claude Code's
// `Edit`: the browser names the old text and the new, or a few attributes, and
// everything else comes from the SAVED document. The whole-document body (`html`)
// is gone since 2026-09-29: its last caller was the editor's Undo, which now
// restores the copy this route keeps (see `versionPrevia` below), and it
// sanitized the WHOLE page — every `onclick` the model wrote, every iframe
// outside the allow-list — on each undo.
//
// The handler only swaps the html inside the JSONB envelope; everything else in
// `data` (meta, plan, cost, …) is preserved verbatim.
//
// Version snapshots + the concurrent-edit guard apply to BOTH scopes — each
// document keeps its own timeline (projectVersions.page).
//
// `hasUnpublishedChanges` is computed at read time in lib/projects.ts by
// comparing `data.html` to `publishedHtml`, so no work to do here beyond
// updating html + the row's updatedAt.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";

/**
 * Techo de ediciones por lote — un techo de coste, no de diseño.
 *
 * Lo puso la re-tinta de las temáticas: cambiar el mundo de colores mide el
 * contraste de cada texto de la página y re-entinta el que no se leería, así
 * que un lote de 300-400 ediciones es lo NORMAL ahí, no un abuso. Con cien no
 * cabía una página mediana.
 *
 * MEDIDO el 2026-08-27 sobre un documento de 47 KB, que es el tamaño típico:
 * 100 ediciones 219 ms · 200 ediciones 427 ms · 450 ediciones 1.339 ms. Lineal,
 * porque `aplicarEdiciones` agrupa los `atributos` consecutivos en un solo
 * estampado (no cambian la estructura, así que ninguna ruta se desplaza). Antes
 * de agruparlos era cuadrático y 400 ediciones tardaban 2,2 s sobre un
 * documento cuatro veces más pequeño.
 */
const MAX_EDICIONES = 500;
// Idle-based checkpoint cadence for inline content edits and inspector
// `props` edits — if it's been at least this long since the document's
// most-recent version of any kind, the next PATCH writes a "manual"
// snapshot so the user has natural undo points across long editing
// sessions. Short bursts of edits share a single snapshot; sustained
// editing produces one checkpoint per window.
const IDLE_CHECKPOINT_MS = 5 * 60 * 1000;

interface PatchBody {
  /** Qué cambió, no cómo quedó la pantalla.
   *
   *  Se aplican en orden contra el documento GUARDADO, así que el script del
   *  modelo puede hacer lo que quiera en el lienzo — no se lee nunca. Es lo
   *  que hace v0 en su Design Mode: serializa las ediciones, no el DOM.
   *
   *  ⚰️ Aquí había también `html`, el documento entero: el camino viejo, que
   *  saneaba la página completa y sólo le devolvía los `<script>`. Ver la
   *  cabecera. */
  edits?: Edicion[];
  /** Distinguishes inline-text edits (default — idle-checkpointed) from
   *  structural mutations (reorder, replace) which always snapshot so the
   *  version timeline shows them distinctly. Anything unrecognized is
   *  treated as inline-edit. */
  source?: "inline-edit" | "reorder" | "replace" | "props" | "section-insert";
  /** ms-epoch of the project's updatedAt this tab last wrote. When it no
   *  longer matches, another writer (typically a second browser tab) changed
   *  the project since — the current document is about to be clobbered, so we
   *  snapshot it into the version history first. Inline-edit autosaves are
   *  only idle-checkpointed every few minutes, so without this a two-tab
   *  edit race could drop text that lives in no version. */
  baseUpdatedAt?: number;
  /** Multi-page: slug of the site page being saved. Absent = the home
   *  document (data.html). */
  page?: string;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  const acceso = await exigirAcceso(id, session.user.id, "editar");
  if (acceso instanceof Response) return acceso;
  const duenoId = acceso.duenoId;

  const body = (await req.json().catch(() => null)) as PatchBody | null;
  if (!body || !Array.isArray(body.edits)) {
    return json({ error: "invalid_body", message: "edits array is required" }, 400);
  }
  const edits = body.edits;
  if (edits.length === 0 || edits.length > MAX_EDICIONES) {
    return json(
      { error: "invalid_body", message: `edits must be 1..${MAX_EDICIONES}` },
      400,
    );
  }
  const rows = await db
    .select({
      data: schema.projects.data,
      updatedAt: schema.projects.updatedAt,
    })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, id),
        eq(schema.projects.userId, duenoId),
      ),
    )
    .limit(1);
  const existing = rows[0];
  if (!existing) return json({ error: "not_found" }, 404);

  // Multi-page: a `page` slug routes the save into data.pages[slug].html.
  // The page must already exist (creation goes through POST /pages) so a
  // mistyped slug can't silently grow the map.
  let page: string | null = null;
  if (typeof body.page === "string" && body.page.length > 0) {
    const check = validatePageSlug(body.page);
    const slug = check.ok ? check.slug : null;
    const pageRow =
      slug && existing.data ? existing.data.pages?.[slug] : undefined;
    if (!slug || !pageRow) return json({ error: "page_not_found" }, 404);
    page = slug;
  }

  const guardado =
    (page ? existing.data?.pages?.[page]?.html : existing.data?.html) ?? "";

  // LAS EDICIONES SE APLICAN AL DOCUMENTO GUARDADO. El `<script>` del modelo,
  // sus `onclick` y sus iframes nunca salen de la base, así que no pueden
  // perderse ni duplicarse.
  const r = aplicarEdiciones(guardado, edits);
  if (!r.ok) {
    // 409, no 400: la petición era válida: el DOCUMENTO cambió debajo. El
    // cliente tiene que recargar y volver a intentarlo, no reformular.
    // Se rechaza el LOTE ENTERO — media edición guardada es peor que ninguna,
    // porque el usuario ve parte de su trabajo y no sabe qué falta.
    return json(
      { error: "edits_stale", motivo: r.motivo, indice: r.indice, detalle: r.detalle },
      409,
    );
  }
  const html = r.html;
  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
    return json({ error: "too_large", message: "HTML must be under 8 MB" }, 413);
  }

  // Concurrency guard. If another writer changed the project since the client
  // loaded its base, the current document is about to be clobbered — snapshot
  // it into the version history first so the about-to-be-lost state stays
  // recoverable. createVersion dedups against the latest version in the same
  // scope, so the common no-conflict first save (base 0) costs nothing.
  // Soft — never blocks the save.
  if (
    typeof body.baseUpdatedAt === "number" &&
    existing.updatedAt.getTime() !== body.baseUpdatedAt
  ) {
    const staleHtml = page
      ? existing.data?.pages?.[page]?.html ?? ""
      : existing.data?.html ?? "";
    if (staleHtml && staleHtml !== html) {
      try {
        await createVersion({
          projectId: id,
          html: staleHtml,
          label: "Saved before a concurrent edit",
          source: "manual",
          page,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[projects/html] conflict snapshot failed", err);
      }
    }
  }

  // LA COPIA DE ANTES, para Deshacer. Es el `fileHistoryTrackEdit` de Claude
  // Code: antes de modificar un fichero guarda su copia, y `/rewind` restaura
  // ESA copia — nunca una que le mande quien pide deshacer. Aquí el Deshacer
  // del taller mandaba la página entera desde el navegador, y había que
  // sanearla entera: cada Deshacer le quitaba a la página todos sus `onclick`.
  // Ahora el taller restaura esta versión (`POST …/versions/<id>/restore`),
  // igual que el Deshacer del Chat con su «Before AI edit».
  //
  // Blanda: si no se puede escribir, el cambio se guarda igual y el taller
  // dice que no hay Deshacer, en vez de ofrecer uno que no existe.
  let versionPrevia: string | null = null;
  try {
    versionPrevia = await createVersion({
      projectId: id,
      html: guardado,
      label: "Before manual edit",
      source: "manual",
      page,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[projects/html] pre-edit snapshot failed", err);
  }

  // Preserve everything else in `data` (notably data.settings — the Phase 2
  // form config — and sibling pages) — only this document's html changes.
  //
  // I4 — y la fusión ocurre sobre el `data` de AHORA, dentro del
  // compare-and-swap. La guarda `baseUpdatedAt` de arriba es BLANDA: archiva y
  // sigue. Ésta es la dura, y cubre el otro eje — el que no se veía: quien
  // guarda un titular escribía también `settings` y las páginas hermanas tal y
  // como las leyó, así que una edición del Agente en /menu podía desaparecer al
  // guardar un texto en la Home.
  let now: Date;
  try {
    const escrito = await actualizarData({
      projectId: id,
      userId: duenoId,
      aplicar: (actual) =>
        page
          ? { ...actual, pages: { ...actual.pages, [page]: { ...actual.pages?.[page], html } } }
          : { ...actual, html },
    });
    if (!escrito.ok) {
      // 409 con el mismo código que ya usa el camino de ediciones: la petición
      // era válida, el documento se movió debajo.
      return escrito.motivo === "conflicto"
        ? json({ error: "edits_stale", motivo: "la fila cambió mientras se guardaba" }, 409)
        : json({ error: "not_found" }, 404);
    }
    now = escrito.updatedAt;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[projects/html] db update failed", err);
    return json({ error: "db_update_failed" }, 500);
  }

  try {
    const idleCheckpoint = async (label: string) => {
      // Idle-checkpoint por documento — una racha de edición no debe crear
      // una versión por interacción (con controles de pasos serían docenas),
      // y el churn de home no debe suprimir el checkpoint de una subpágina.
      const latest = await db
        .select({ createdAt: schema.projectVersions.createdAt })
        .from(schema.projectVersions)
        .where(
          and(
            eq(schema.projectVersions.projectId, id),
            page === null
              ? isNull(schema.projectVersions.page)
              : eq(schema.projectVersions.page, page),
          ),
        )
        .orderBy(desc(schema.projectVersions.createdAt))
        .limit(1);
      const lastAt = latest[0]?.createdAt;
      const elapsed = lastAt ? now.getTime() - lastAt.getTime() : Infinity;
      if (elapsed >= IDLE_CHECKPOINT_MS) {
        await createVersion({ projectId: id, html, label, source: "manual", page });
      }
    };
    if (body.source === "reorder") {
      // Reorders are structural — snapshot every time (createVersion's
      // own dedupe handles consecutive byte-identical posts).
      await createVersion({
        projectId: id,
        html,
        label: "Reordered sections",
        source: "reorder",
        page,
      });
    } else if (body.source === "replace") {
      // Asset replacements (icon / image swap) are intentional, distinct
      // actions — always snapshot.
      await createVersion({
        projectId: id,
        html,
        label: "Replaced asset",
        source: "replace",
        page,
      });
    } else if (body.source === "props") {
      await idleCheckpoint("Edited properties");
    } else if (body.source === "section-insert") {
      // Inserting a library section is a discrete structural action —
      // snapshot it so the user has a clean undo point before/after.
      await createVersion({
        projectId: id,
        html,
        label: "Inserted section",
        source: "manual",
        page,
      });
    } else {
      await idleCheckpoint("Edited content");
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[projects/html] version snapshot failed", err);
  }

  // El documento va en la respuesta: el cliente no lo tiene —él sólo mandó QUÉ
  // cambió— y lo necesita para que el resto de la aplicación (la pestaña de
  // código, el Chat, publicar) vea lo mismo que el lienzo. Y la copia de antes,
  // que es lo que su Deshacer restaura.
  return json({ ok: true, updatedAt: now.toISOString(), html, versionPrevia }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
