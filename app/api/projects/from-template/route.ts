import { auth } from "@/auth";
import { topeDeIngestion } from "@/lib/ingestion/tope";
import { db, schema } from "@/lib/db";
import { getTemplate, getTemplateHtml } from "@/lib/templates/store";
import { createVersion } from "@/lib/projects/versions";
import { gateReservedMarker } from "@/lib/html-engine";
import { passHtmlGate } from "@/lib/html-gate/document-gate";
import { pageMetaFor } from "@/lib/publish/page-meta-intent";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/from-template
// Body: { templateId: string }
//
// Clones a curated template's HTML into a NEW project owned by the caller.
// The template's HTML is stored verbatim in `project.data.html`, so the
// publish path (publishProject → publishToDir → Caddy) treats it like any
// other project's output.
//
// The template itself NEVER claims a subdomain — only the project the user
// publishes does (e.g. myco.openlen.app).
//
// LA ENTRADA COMO VERCEL (2026-10-04, decidido por Jesús): la plantilla se
// clona como es, con su JavaScript. Sólo pasa `gateReservedMarker`, como lo que
// escribe el modelo. Hasta ese día pasaba `sanitizeForPublish`, que borraba los
// `<script>`; `conservarScripts` los devolvía desde el documento curado y el
// transformador de ingestión (lib/transform) horneaba lo que generaban — y
// tenía que quitar el generador para que la sección no saliera dos veces. Las
// tres piezas se fueron: los scripts llegan vivos y generan su contenido ellos.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";

interface FromTemplateBody {
  templateId?: string;
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);

  // ── EL TOPE DE INGESTIÓN ───────────────────────────────────────────────────
  //
  // Nació porque el transformador de ingestión arrancaba un Chromium por
  // documento (un clon de 6 páginas eran SIETE arranques). El transformador se
  // fue el 2026-10-04; el tope se queda porque cada clon sigue escribiendo un
  // proyecto y sus versiones, y sin él ese bucle sale gratis.
  //
  // Va ANTES de leer la plantilla de almacenamiento: rechazar después de haber
  // ido a buscar el cuerpo por la red es pagar la mitad del trabajo que se está
  // rechazando.
  //
  // El tope es holgado (15/h en gratis): quien está mirando plantillas clona
  // varias en un rato, y bloquearle eso sería fricción para el usuario final.
  // Lo que se corta es el bucle, no la exploración.
  const limite = await topeDeIngestion(session.user.id);
  if (limite) return limite;

  const body = (await req.json().catch(() => null)) as FromTemplateBody | null;
  if (!body || typeof body.templateId !== "string") {
    return json({ error: "invalid_body" }, 400);
  }

  const entry = await getTemplate(body.templateId);
  if (!entry || entry.status !== "published") {
    return json({ error: "unknown_template", id: body.templateId }, 404);
  }

  // Fetch the canonical HTML body from object storage. Cached at the CDN
  // edge in prod (R2); local FS read in dev.
  const html = await getTemplateHtml(entry.id);
  if (!html) {
    // eslint-disable-next-line no-console
    console.error("[from-template] failed to fetch template body", entry.id);
    return json({ error: "template_body_unavailable" }, 500);
  }

  // ⚰️ Aquí se resolvía el PERFIL DE NEGOCIO al crear (`resolveProfileForCreation`)
  // para que la página naciera con los datos del dueño. Retirado el 2026-08-31.
  // Los datos viven en la página; el logo se pone desde el inspector, que es
  // donde el dueño lo ve.

  // One gate. This surface FAILS OPEN: the project does
  // not exist yet, so refusing costs the user the whole page rather than an
  // edit. `seal: false` (publishToDir seals at publish time), `render: false`
  // (a clone cannot pay a browser launch).
  //
  const gated = await passHtmlGate(
    html,
    {
      sanitize: gateReservedMarker,
      // ⚰️ Aquí se sembraba el perfil de negocio (`seedBrandIntoHtml`).
      // Retirado el 2026-08-31: los datos del dueño viven en su página, no en
      // otra tabla que los repinta. Con el widget de contacto ya fuera, lo
      // único que quedaba era el acento de marca — y el color de una página lo
      // decide el modelo o el inspector, que es donde el dueño lo ve.
    },
    {
      render: false,
      seal: false,
      // CLONED: the curated body's <title>/og copy is OUR marketing, not this
      // user's. Preserving it published another product's name into their tab,
      // their Google result and their WhatsApp card.
      meta: pageMetaFor({ provenance: "cloned", title: entry.name }),
    },
  );
  if (!gated.ok) {
    // A curated template that cannot pass the gate is OUR broken file, not the
    // user's input — 500 and name it. `gateReservedMarker` refuses only for
    // the reserved marker.
    return json(
      {
        error: "invalid_template",
        message: "Template HTML contains data-slot-path markers — fix the curated file.",
      },
      500,
    );
  }
  const finalHtml = gated.html;

  // ⚰️ Aquí se apuntaba en la fila lo que el clon perdió (`collectDegradations`:
  // el contenido que el transformador no llegó a hornear y los `on*` que el
  // saneador borraba). Desde el 2026-10-04 la puerta no quita nada.

  // Multi-page template: clone each extra page through the same gate into
  // project.data.pages, so a cloned site is multi-page from birth (e.g. Home +
  // Tienda + product fichas).
  const clonedPages: Record<string, { html: string }> = {};
  for (const pg of entry.pages ?? []) {
    // Degradation #6. This used to `continue` — the subpage vanished, the
    // clone shipped, and the nav still promised a page that no longer
    // existed. Because a broken link serves the HOME page
    // ([[caddy-broken-links-serve-home]]) the user had no way to discover it:
    // the site LOOKED complete and lied about itself. A page that cannot pass
    // the gate is our broken curated file, so it fails the whole clone loudly,
    // the same way the home page already does above.
    const pgGated = await passHtmlGate(
      pg.html,
      { sanitize: gateReservedMarker },
      {
        render: false,
        seal: false,
        // AUTHORED, deliberately — not because a human wrote a subpage's head,
        // but because the takeover is all-or-nothing (`takeover =
        // replaceStaleMeta && title`) and the only title in hand is the
        // project's. Taking over here would rename "Tienda" and every other
        // subpage to the template's name, flattening the page-specific titles
        // that make a multi-page site navigable.
        //
        // The title still travels: non-destructive means it is used ONLY when
        // the subpage carries none of its own, which is exactly what a fallback
        // is for.
        meta: pageMetaFor({ provenance: "authored", title: entry.name }),
      },
    );
    if (!pgGated.ok) {
      return json(
        {
          error: "invalid_template",
          message: `Template subpage "${pg.slug}" contains data-slot-path markers — fix the curated file.`,
        },
        500,
      );
    }
    // Sus `<script>` llegan con ella: la puerta no los toca. (Hasta el
    // 2026-10-04 los devolvía `conservarScripts` tras el saneado, y faltó en
    // este bucle del 2026-08-31 al 2026-09-01: la Home clonaba viva y las
    // subpáginas muertas.)
    clonedPages[pg.slug] = { html: pgGated.html };
  }

  const projectId = crypto.randomUUID();
  try {
    await db.insert(schema.projects).values({
      id: projectId,
      userId: session.user.id,
      title: entry.name,
      brief: `Curated template: ${entry.name}`,
      // Inherit the curated template's own rendered preview as the project's
      // initial card thumbnail — a real preview from the first second, no
      // render needed. The screenshot (full-page JPG) is the fallback if the
      // AVIF card thumbnail isn't generated yet. Refreshed to the project's
      // own bytes on first publish.
      thumbnailUrl: entry.thumbnailUrl ?? entry.screenshotUrl ?? null,
      tags: [entry.id, "template", entry.family],
      status: "draft",
      data: {
        html: finalHtml,
        ...(Object.keys(clonedPages).length ? { pages: clonedPages } : {}),
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[from-template] db insert failed", err);
    return json({ error: "db_insert_failed" }, 500);
  }

  // Seed the version history with the freshly-cloned template — gives the
  // user a "back to original" target if they chat the page into oblivion.
  await createVersion({
    projectId,
    html: finalHtml,
    label: `Initial: ${entry.name}`,
    source: "initial",
  }).catch((err: unknown) => {
    // Don't fail the create on a version-write hiccup — the project itself
    // is fine; user just won't have a v0 in their timeline.
    // eslint-disable-next-line no-console
    console.error("[from-template] initial version snapshot failed", err);
  });

  // …and a v0 for each cloned subpage, so "back to original" works per page
  // even if the user chats a subpage into oblivion before the first publish.
  for (const [slug, pg] of Object.entries(clonedPages)) {
    await createVersion({
      projectId,
      html: pg.html,
      label: `Initial: ${entry.name}`,
      source: "initial",
      page: slug,
    }).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error("[from-template] initial page version snapshot failed", slug, err);
    });
  }

  return json({ projectId, title: entry.name }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
