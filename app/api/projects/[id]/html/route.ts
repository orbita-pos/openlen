import { and, desc, eq, isNull } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import type { ProjectData } from "@/lib/projects/types";
import { validatePageSlug } from "@/lib/projects/site-pages";
import { createVersion } from "@/lib/projects/versions";
import { sanitizeForPublish } from "@/lib/html-engine";
import { conservarScripts } from "@/lib/page-engine/conservar-scripts";
import { aplicarEdiciones, type Edicion } from "@/lib/page-engine/aplicar-ediciones";

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/projects/[id]/html — overwrite one of the project's documents:
// `data.html` (home) or, with `page`, `data.pages[slug].html`.
//
// Used by the Design panel on flat (template-clone / paste) projects to
// persist token swaps (accent color, fonts) without going through the
// orchestrator. The handler only swaps the html inside the JSONB envelope;
// everything else in `data` (meta, plan, cost, …) is preserved verbatim.
//
// Version snapshots + the concurrent-edit guard apply to BOTH scopes — each
// document keeps its own timeline (projectVersions.page).
//
// `hasUnpublishedChanges` is computed at read time in lib/projects.ts by
// comparing `data.html` to `publishedHtml`, so no work to do here beyond
// updating html + the row's updatedAt.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";

const MAX_HTML_BYTES = 8 * 1024 * 1024;
/** Techo de ediciones por lote. Con «Aplicar» explícito el usuario puede
 *  acumular muchas antes de guardar, pero cada una re-estampa el documento
 *  entero para resolver su ruta: cien ediciones sobre una página de 45 KB son
 *  cien pasadas del motor. Es un techo de coste, no de diseño. */
const MAX_EDICIONES = 100;
// Idle-based checkpoint cadence for inline content edits and inspector
// `props` edits — if it's been at least this long since the document's
// most-recent version of any kind, the next PATCH writes a "manual"
// snapshot so the user has natural undo points across long editing
// sessions. Short bursts of edits share a single snapshot; sustained
// editing produces one checkpoint per window.
const IDLE_CHECKPOINT_MS = 5 * 60 * 1000;

interface PatchBody {
  /** EL CAMINO VIEJO: una foto del DOM vivo, el documento entero.
   *
   *  Sigue aquí mientras quede algún inyector sin migrar. Su problema es el
   *  que sostiene toda esta obra: para producirla hay que leer la página de
   *  vuelta desde la pantalla, y con el JavaScript del modelo corriendo eso
   *  persiste lo que el script hizo — un filtro que escondió media rejilla se
   *  guarda como el documento del usuario. Por eso el taller lo congela. */
  html?: string;
  /** EL CAMINO NUEVO: qué cambió, no cómo quedó la pantalla.
   *
   *  Se aplican en orden contra el documento GUARDADO, así que el script del
   *  modelo puede hacer lo que quiera en el lienzo — no se lee nunca. Es lo
   *  que hace v0 en su Design Mode: serializa las ediciones, no el DOM.
   *  Mutuamente excluyente con `html`. */
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

  const body = (await req.json().catch(() => null)) as PatchBody | null;
  const porEdiciones = Array.isArray(body?.edits);
  if (!body || (!porEdiciones && typeof body.html !== "string")) {
    return json(
      { error: "invalid_body", message: "html string or edits array is required" },
      400,
    );
  }
  if (porEdiciones && (body.edits!.length === 0 || body.edits!.length > MAX_EDICIONES)) {
    return json(
      { error: "invalid_body", message: `edits must be 1..${MAX_EDICIONES}` },
      400,
    );
  }
  // El saneo del camino viejo. El nuevo sanea cada FRAGMENTO dentro de
  // `aplicarEdiciones` — el documento no se reescribe entero, así que no hay
  // un documento entero que sanear.
  let saneado = "";
  if (!porEdiciones) {
    const rawHtml = body.html!;
    if (Buffer.byteLength(rawHtml, "utf8") > MAX_HTML_BYTES) {
      return json(
        { error: "too_large", message: "HTML must be under 8 MB" },
        413,
      );
    }
    const sanitized = sanitizeForPublish(rawHtml);
    if (sanitized.html === null) {
      return json(
        {
          error: "invalid_html",
          message:
            "HTML contains editor-mode markers (data-slot-path). Save the rendered output instead.",
        },
        400,
      );
    }
    saneado = sanitized.html;
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
        eq(schema.projects.userId, session.user.id),
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

  let html: string;
  if (porEdiciones) {
    // LAS EDICIONES SE APLICAN AL DOCUMENTO GUARDADO. No hay empalme que hacer:
    // el `<script>` del modelo nunca sale de la base, así que no puede
    // perderse ni duplicarse. Ésa es toda la diferencia con el camino de
    // abajo, y es la razón de existir de este camino.
    const r = aplicarEdiciones(guardado, body.edits!);
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
    html = r.html;
  } else {
    // EL EMPALME del camino viejo. Va aquí, después de resolver a QUÉ documento
    // pertenece la edición: los scripts que se restauran son los de ESE
    // documento, no los de la Home. El cuerpo llega del navegador, así que se
    // sanea sin excepción; pero el documento GUARDADO sí lleva el `<script>`
    // del modelo, y sin este empalme la primera edición de un titular mataba el
    // carrito. El código sale de la base, nunca de la petición.
    // Ver lib/page-engine/conservar-scripts.ts.
    html = conservarScripts(guardado, saneado);
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

  // Preserve everything else in `data` (notably data.settings — the Phase 2
  // form config — and sibling pages) — only this document's html changes.
  const baseData: ProjectData = existing.data ?? { html: "" };
  const nextData: ProjectData = page
    ? {
        ...baseData,
        pages: {
          ...baseData.pages,
          [page]: { ...baseData.pages?.[page], html },
        },
      }
    : { ...baseData, html };
  const now = new Date();

  try {
    await db
      .update(schema.projects)
      .set({ data: nextData, updatedAt: now })
      .where(
        and(
          eq(schema.projects.id, id),
          eq(schema.projects.userId, session.user.id),
        ),
      );
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

  // El documento va en la respuesta cuando se guardó por ediciones: el cliente
  // no lo tiene —él sólo mandó QUÉ cambió— y lo necesita para que el resto de
  // la aplicación (la pestaña de código, el Chat, publicar) vea lo mismo que el
  // lienzo. Por el camino viejo el cliente ya lo tenía: él lo mandó.
  return json(
    { ok: true, updatedAt: now.toISOString(), ...(porEdiciones ? { html } : {}) },
    200,
  );
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
