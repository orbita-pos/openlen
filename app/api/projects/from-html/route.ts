import { auth } from "@/auth";
import { topeDeIngestion } from "@/lib/ingestion/tope";
import { db, schema } from "@/lib/db";
import { createVersion } from "@/lib/projects/versions";
import { gateReservedMarker } from "@/lib/html-engine";
import { passHtmlGate } from "@/lib/html-gate/document-gate";
import { renderProjectThumbnail } from "@/lib/projects/thumbnail";
import { pageMetaFor } from "@/lib/publish/page-meta-intent";
import { MAX_HTML_BYTES } from "@/lib/projects/limites-html";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/from-html
// Body: { html: string, title?: string }
//
// Accepts ANY HTML string from the client (typically pasted from a claude.ai
// artifact) and persists it as the new project's `data.html`. The Deploy
// dropdown on /new then publishes that HTML verbatim through
// `publishProject` → `publishToDir`.
//
// LA ENTRADA COMO VERCEL (2026-10-04, decidido por Jesús). Lo que se pega se
// guarda como se pegó, con su JavaScript: aquí no pasa `sanitizeForPublish`,
// sólo `gateReservedMarker`, la MISMA puerta que lo que escribe el modelo. Hasta
// ese día el saneador borraba todos los `<script>` y el transformador de
// ingestión (lib/transform, retirado) intentaba hornear lo que generaban;
// ahora los scripts llegan vivos y lo generan ellos.
//
// La razón de seguridad del saneador la cubre el aislamiento: el lienzo corre
// en un origen opaco o en otro sitio (`sandbox-del-lienzo.ts`), y la página
// publicada vive en `<sub>.<publish host>`, otro origen que la app.
//
// Safety:
// - 8 MB max HTML size.
// - Rejects `data-slot-path=` editor markers, in every variant; the same gate
//   runs again in publishToDir as defense in depth.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";


interface FromHtmlBody {
  html?: string;
  title?: string;
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);

  // ── EL TOPE DE INGESTIÓN ───────────────────────────────────────────────────
  //
  // Nació por el transformador, que arrancaba un Chromium por petición con HTML
  // arbitrario. Se fue el 2026-10-04, pero la miniatura de abajo sigue
  // arrancando uno por página pegada, y nada más lo frena: ni crédito, ni cuota
  // de generación.
  const limite = await topeDeIngestion(session.user.id);
  if (limite) return limite;

  const body = (await req.json().catch(() => null)) as FromHtmlBody | null;
  if (!body || typeof body.html !== "string" || body.html.trim().length === 0) {
    return json(
      { error: "invalid_body", message: "html string is required" },
      400,
    );
  }
  const html = body.html;
  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
    return json({ error: "too_large", message: "HTML must be under 8 MB" }, 413);
  }

  const title =
    (typeof body.title === "string" && body.title.trim()) ||
    extractTitle(html) ||
    "Untitled page";

  // ⚰️ Aquí se resolvía el PERFIL DE NEGOCIO al crear (`resolveProfileForCreation`)
  // para que la página naciera con los datos del dueño. Retirado el 2026-08-31.
  // Los datos viven en la página; el logo se pone desde el inspector, que es
  // donde el dueño lo ve.

  // One gate. This surface FAILS OPEN: the project does
  // not exist yet, so refusing costs the user the whole page instead of an
  // edit. `seal: false` (publishToDir seals at publish time) and
  // `render: false` (a paste cannot pay a browser launch).
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
      // AUTHORED: a human may have written this <head>. Never take it over.
      meta: pageMetaFor({ provenance: "authored", title }),
    },
  );
  if (!gated.ok) {
    // The reserved marker never fails open, anywhere. `gateReservedMarker`
    // refuses ONLY for it, so both codes mean the same thing here: the literal
    // marker, or one of its encoded variants.
    return json(
      {
        error: "invalid_html",
        message:
          "HTML contains editor-mode markers (data-slot-path). Save the rendered output instead.",
      },
      400,
    );
  }
  const finalHtml = gated.html;

  // ⚰️ Aquí se apuntaba en la fila lo que la página perdió al entrar
  // (`collectDegradations`: scripts, embebidos, enlaces peligrosos y el
  // contenido que el transformador no horneó). Desde el 2026-10-04 la puerta
  // no quita nada, así que no hay pérdida que apuntar.

  const projectId = crypto.randomUUID();
  try {
    await db.insert(schema.projects).values({
      id: projectId,
      userId: session.user.id,
      title,
      brief: `Pasted HTML${body.title ? `: ${body.title}` : ""}`,
      thumbnailUrl: null,
      tags: ["paste"],
      status: "draft",
      data: { html: finalHtml },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[from-html] db insert failed", err);
    return json({ error: "db_insert_failed" }, 500);
  }

  // Seed the version history with the pasted HTML — anchor point the user
  // can restore to if subsequent chats / inline edits ruin the page.
  await createVersion({
    projectId,
    html: finalHtml,
    label: "Pasted HTML",
    source: "initial",
  }).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error("[from-html] initial version snapshot failed", err);
  });

  // Background card thumbnail so the pasted page shows a preview in /projects
  // instead of the placeholder icon. Fire-and-forget — never blocks the create.
  // Its Chromium blocks private and internal addresses
  // (`installSubresourceSsrfGuard`): the pasted JavaScript runs there too.
  void renderProjectThumbnail({ projectId, html: finalHtml });

  return json({ projectId, title }, 200);
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const inner = match?.[1]?.trim();
  return inner && inner.length > 0 ? inner.slice(0, 200) : null;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
