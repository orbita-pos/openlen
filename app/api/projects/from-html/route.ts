import { auth } from "@/auth";
import { topeDeIngestion } from "@/lib/ingestion/tope";
import { createProjectFromHtml } from "@/lib/projects/create-from-html";

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
// Lo que hace con el HTML (el tope de 8 MB, la puerta del marcador
// `data-slot-path=`, el insert, la versión inicial y la miniatura) vive en
// `lib/projects/create-from-html.ts`: lo comparte con el servidor MCP
// (`create_project`, plans/mcp-de-openlen).
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
  // arbitrario. Se fue el 2026-10-04, pero la miniatura sigue arrancando uno
  // por página pegada, y nada más lo frena: ni crédito, ni cuota de generación.
  const limite = await topeDeIngestion(session.user.id);
  if (limite) return limite;

  const body = (await req.json().catch(() => null)) as FromHtmlBody | null;
  if (!body || typeof body.html !== "string" || body.html.trim().length === 0) {
    return json({ error: "invalid_body", message: "html string is required" }, 400);
  }

  const r = await createProjectFromHtml({
    userId: session.user.id,
    html: body.html,
    ...(typeof body.title === "string" ? { title: body.title } : {}),
  });
  if (!r.ok) {
    if (r.error === "empty") return json({ error: "invalid_body", message: "html string is required" }, 400);
    if (r.error === "too_large") return json({ error: "too_large", message: "HTML must be under 8 MB" }, 413);
    if (r.error === "invalid_html") {
      return json(
        {
          error: "invalid_html",
          message: "HTML contains editor-mode markers (data-slot-path). Save the rendered output instead.",
        },
        400,
      );
    }
    return json({ error: "db_insert_failed" }, 500);
  }
  return json({ projectId: r.projectId, title: r.title }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
