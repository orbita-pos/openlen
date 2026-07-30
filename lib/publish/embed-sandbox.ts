// Aislamiento de las superficies que sirven HTML de proyecto para INCRUSTAR.
//
// El problema (auditoría 2026-07-29): /api/projects/<id>/raw,
// /api/projects/<id>/versions/<vid>/raw y /api/sections/<id>/preview sirven
// documentos desde el MISMO origen que la app y sin CSP, y los iframes que los
// muestran usaban `allow-scripts allow-same-origin` — dos banderas que juntas
// anulan el sandbox. Medido en navegador: un script dentro de esos documentos
// leía cookies, leía y ESCRIBÍA el DOM del padre y hacía fetch autenticado.
//
// Hoy no es explotable porque su contenido está sanitizado (o es first-party
// sembrado por CLI), o sea que TODA la seguridad descansa en el sanitizador,
// sin una segunda línea. Esto es esa segunda línea: la CSP `sandbox` sin
// `allow-same-origin` le da al documento un origen OPACO — aunque algún día se
// cuele un script, no alcanza cookies, storage ni la API con la sesión.
//
// Por qué mirar `Sec-Fetch-Dest` en vez de mandar la CSP siempre: /raw tiene
// dos usos. Como miniatura en un iframe (a aislar) y como "abrir en pestaña"
// del preview (page.tsx, `?bake=1`), que es una página navegable donde el
// usuario hace clic en sus propios enlaces — sandboxearla rompería esos clics.
// El header lo pone el navegador y una página no puede falsificarlo (es un
// nombre de header prohibido), así que distingue los dos casos con fiabilidad.
//
// Si el header falta (cliente viejo, curl, un bot), se sirve como hasta hoy:
// no empeora nada respecto del estado previo, y los iframes propios ya no
// llevan `allow-same-origin`, así que el aislamiento no depende solo de esto.

/** `sandbox` SIN allow-same-origin → origen opaco. Los scripts siguen
 *  corriendo (el CDN de Tailwind es lo que pinta estas previsualizaciones),
 *  pero ya no son los de openlen.com. Misma política que el preview de
 *  marketing (app/api/marketing/preview/route.ts). */
export const EMBED_SANDBOX_CSP = "sandbox allow-scripts";

/** Destinos en los que el documento se pinta DENTRO de otra página. */
const FRAMED = new Set(["iframe", "frame", "embed", "object"]);

/** Headers a mezclar en la respuesta: la CSP solo cuando el documento va
 *  incrustado. Devuelve {} en navegación de primer nivel. */
export function embedSandboxHeaders(req: Request): Record<string, string> {
  const dest = req.headers.get("sec-fetch-dest")?.trim().toLowerCase() ?? "";
  return FRAMED.has(dest) ? { "content-security-policy": EMBED_SANDBOX_CSP } : {};
}
