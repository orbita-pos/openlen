import { leerDocumento } from "@/lib/lienzo/almacen";
import { etiquetaDeLienzo, etiquetaDelHost, frameAncestors } from "@/lib/lienzo/host";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/lienzo/[docId] — sirve un documento del lienzo en SU host,
// `lienzo-<id>.<dominio de páginas>`: un origen de verdad y de otro sitio que
// openlen.com. Allí el iframe del taller lo carga con el sandbox de la
// publicada (allow-same-origin incluido, que es seguro precisamente por ser
// otro sitio).
//
// 🔴 SI EL HOST NO ES UN LIENZO, 404. Esta ruta existe también en openlen.com
// (Next no distingue hosts), y servir ahí el borrador de un usuario con su
// JavaScript sería el agujero de la auditoría del 2026-07-29.
//
// Un solo 404 para todo —host ajeno, id desconocido, caducado— para no
// confirmar qué existe.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noEncontrado(): Response {
  return new Response("not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ docId: string }> },
): Promise<Response> {
  const { docId } = await params;
  const etiqueta = etiquetaDelHost(req.headers.get("host") ?? new URL(req.url).host);
  if (!etiqueta) return noEncontrado();

  const doc = leerDocumento(docId);
  if (!doc || etiquetaDeLienzo(doc.projectId) !== etiqueta) return noEncontrado();

  return new Response(doc.html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": `frame-ancestors ${frameAncestors()}`,
      // La misma que la publicada (infra/caddy/Caddyfile, bloque *.openlen.app).
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}
