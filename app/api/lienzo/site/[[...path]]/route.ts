import { isPublishableFolderPath, contentTypeFor } from "@/lib/agent/ficheros/folder";
import { leerDocumento, proyectoDeEtiqueta } from "@/lib/lienzo/almacen";
import { LIENZO_PARAM, etiquetaDeLienzo, etiquetaDelHost, frameAncestors } from "@/lib/lienzo/host";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/lienzo/site/<ruta> — EL SITIO ENTERO DEL LIENZO (pieza 9 de Len 2.5).
//
// En un host `lienzo-<etiqueta>.<dominio>` el middleware manda aquí TODO
// (`lib/lienzo/site-rewrite.ts`), con la ruta que pidió el navegador. Se
// contestan dos cosas, como las contestaría la publicada:
//
//   · un fichero de la carpeta (`/js/app.js`, `/data/menu.json`): lo GUARDADO
//     en `projectFiles`, sólo si se publica, y sólo mientras el dueño tiene un
//     documento vivo de ese proyecto (`proyectoDeEtiqueta`);
//   · el documento del lienzo, `?__lienzo=<docId>`, en la ruta de su página
//     (`/` o `/<slug>/index.html`): lo que el dueño tiene en pantalla.
//
// 🔴 La llave es el HOST: su etiqueta es un HMAC del id (no se adivina) y sólo
// abre lo de su proyecto. Un solo 404 para todo —host ajeno, documento ajeno,
// caducado, fichero que no existe o no se publica— para no confirmar qué
// existe, con las mismas cabeceras que `[docId]`.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noEncontrado(): Response {
  return new Response("not found", {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": `frame-ancestors ${frameAncestors()}`,
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const { path = [] } = await params;
  const url = new URL(req.url);
  const etiqueta = etiquetaDelHost(req.headers.get("host") ?? url.host);
  if (!etiqueta) return noEncontrado();
  // Los segmentos de la carpeta y de las páginas son `[A-Za-z0-9._-]`: no hay
  // nada que decodificar, y lo que traiga otra cosa no casa con nada.
  const ruta = `/${path.join("/")}`;

  // UN FICHERO DE LA CARPETA. Primero, porque una ruta de la carpeta nunca es
  // la de un documento (`index.html` no puede ser un fichero de la carpeta).
  if (isPublishableFolderPath(ruta)) {
    const dueno = proyectoDeEtiqueta(etiqueta);
    if (!dueno) return noEncontrado();
    const { listProjectFiles } = await import("@/lib/backend/files");
    const files = await listProjectFiles(dueno.projectId, ruta).catch(() => null);
    const body = files?.[ruta];
    if (body === undefined) return noEncontrado();
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": contentTypeFor(ruta),
        // Un borrador: ni el navegador ni el borde lo guardan.
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      },
    });
  }

  // EL DOCUMENTO, en la ruta de su página.
  const docId = url.searchParams.get(LIENZO_PARAM);
  if (!docId) return noEncontrado();
  const doc = leerDocumento(docId);
  if (!doc || etiquetaDeLienzo(doc.projectId) !== etiqueta) return noEncontrado();
  const suRuta = doc.pagina ? `/${doc.pagina}/index.html` : "/";
  if (ruta !== suRuta) return noEncontrado();

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
