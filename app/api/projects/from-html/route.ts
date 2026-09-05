import { auth } from "@/auth";
import { topeDeIngestion } from "@/lib/ingestion/tope";
import { db, schema } from "@/lib/db";
import { createVersion } from "@/lib/projects/versions";
import { sanitizeForPublish } from "@/lib/html-engine";
import { passHtmlGate } from "@/lib/html-gate/document-gate";
import { collectDegradations, hadScript } from "@/lib/ingestion/degradations";
import { transformIngestedHtml } from "@/lib/transform";
import { renderProjectThumbnail } from "@/lib/projects/thumbnail";
import { pageMetaFor } from "@/lib/publish/page-meta-intent";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/from-html
// Body: { html: string, title?: string }
//
// Accepts ANY HTML string from the client (typically pasted from a claude.ai
// artifact) and persists it as the new project's `data.html`. The Deploy
// dropdown on /new then publishes that HTML verbatim through
// `publishProject` → `publishToDir`.
//
// Safety:
// - 8 MB max HTML size.
// - sanitizeForPublish() strips inline scripts / on*-handlers / dangerous-URL
//   schemes / iframes / meta-refresh (Tailwind CDN is preserved) and rejects
//   `data-slot-path=` editor markers. We store the CLEANED html; the same gate
//   runs again in publishToDir as defense in depth.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";

const MAX_HTML_BYTES = 8 * 1024 * 1024;

interface FromHtmlBody {
  html?: string;
  title?: string;
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);

  // ── EL TOPE DE INGESTIÓN ───────────────────────────────────────────────────
  //
  // 🔴 Y AQUÍ ES MÁS GORDO QUE EN EL CLON. `from-template` al menos cachea el
  // transform por (plantilla, hash), así que la segunda persona que clona la
  // misma plantilla no arranca ningún navegador. Ésta NO cachea nada —lo dice su
  // propio comentario, «contenido de un solo uso»— así que CADA petición paga su
  // Chromium entero, con HTML arbitrario y sin nada que lo frene: ni crédito, ni
  // cuota de generación, ni tope.
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

  // Transform de ingestión (lib/transform, spec 2026-07-14) — ANTES del
  // sanitize porque lee los <script> que aquel borra: el HTML pegado tiene el
  // MISMO bug que las plantillas (contenido JS-generado nace vacío, botones
  // muertos). Chrome con red TOTALMENTE bloqueada + 5s de presupuesto; ante
  // cualquier fallo devuelve el html original — la ruta queda exactamente
  // como hoy, jamás peor. Sin cache: contenido de un solo uso.
  const transformed = await transformIngestedHtml(html, {
    timeoutMs: 5000,
    source: "from-html",
  });

  const title =
    (typeof body.title === "string" && body.title.trim()) ||
    extractTitle(html) ||
    "Untitled page";

  // ⚰️ Aquí se resolvía el PERFIL DE NEGOCIO al crear (`resolveProfileForCreation`)
  // para que la página naciera con los datos del dueño. Retirado el 2026-08-31.
  // Los datos viven en la página; el logo se pone desde el inspector, que es
  // donde el dueño lo ve.

  // One gate. `behaviors: "warn"` — this surface FAILS OPEN: the project does
  // not exist yet, so refusing costs the user the whole page instead of an
  // edit. It ships and we tell them what was lost. `seal: false` (publishToDir
  // seals at publish time) and `render: false` (a paste cannot pay a browser
  // launch).
  //
  // ⚰️ Decía «Seeding rides in `beforeMeta`, which is the slot Task 2 built for
  // exactly this». Ya no cabalga nada: esta llamada NO pasa un `beforeMeta` —la
  // siembra del perfil de negocio se retiró el 2026-08-31, ver la lápida de
  // arriba— y el único `beforeMeta` vivo del repo es el de
  // `lib/page-engine/prepare.ts`. Corregido el 2026-09-05.
  const gated = await passHtmlGate(
    transformed.html,
    {
      sanitize: sanitizeForPublish,
      // ⚰️ Aquí se sembraba el perfil de negocio (`seedBrandIntoHtml`).
      // Retirado el 2026-08-31: los datos del dueño viven en su página, no en
      // otra tabla que los repinta. Con el widget de contacto ya fuera, lo
      // único que quedaba era el acento de marca — y el color de una página lo
      // decide el modelo o el inspector, que es donde el dueño lo ve.
    },
    {
      render: false,
      seal: false,
      behaviors: "warn",
      // AUTHORED: a human may have written this <head>. Never take it over.
      meta: pageMetaFor({ provenance: "authored", title }),
    },
  );
  if (!gated.ok) {
    // The reserved marker never fails open, anywhere — including when the
    // seeding seam is what introduced it.
    if (gated.code === "reserved_marker") {
      return json(
        {
          error: "invalid_html",
          message:
            "HTML contains editor-mode markers (data-slot-path). Save the rendered output instead.",
        },
        400,
      );
    }
    return json({ error: "sanitization_failed", message: "Could not clean this HTML." }, 400);
  }
  const finalHtml = gated.html;

  // What the page lost on the way in. Stored on the ROW, not returned — every
  // creation client navigates away and destructures the response down to
  // `projectId`, so a field added there would be dead on arrival.
  const degradations = collectDegradations({
    surface: "from-html",
    removed: gated.removed,
    behaviorIssues: gated.issues,
    transformFallback: transformed.report.fallback,
    hadScripts: hadScript(html),
  });

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
      data: { html: finalHtml, ...(degradations.length > 0 ? { degradations } : {}) },
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
