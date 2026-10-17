// LO DEL HOST DEL LIENZO QUE SE PUEDE IMPORTAR EN CUALQUIER SITIO.
//
// `host.ts` usa `node:crypto` desde la pieza 9 de Len 2.5 (la etiqueta es un
// HMAC del id), así que ya no puede entrar en el cliente ni en el middleware,
// que corre en el borde. Lo que necesitan los dos —el prefijo
// (`lib/subdomain/validate.ts`) y leer la etiqueta de un host
// (`middleware.ts`)— vive aquí, puro.

export const LIENZO_PREFIJO = "lienzo-";

/** La etiqueta de lienzo del primer tramo de un host, o null si no lo es. */
export function etiquetaDelHost(host: string | null | undefined): string | null {
  const nombre = String(host ?? "").trim().toLowerCase().replace(/:\d+$/, "");
  if (!nombre.includes(".")) return null;
  const primera = nombre.split(".")[0] ?? "";
  return /^lienzo-[0-9a-f]{32}$/.test(primera) ? primera : null;
}

/** LOS VISUALES DE LEN (spec local 2026-10-16-len-inline-visuals): la etiqueta
 *  del host donde corre el marco de los visuales del chat. Un solo host, que no
 *  guarda nada de nadie; queda reservado por el prefijo `lienzo-`. */
export const VISUALS_LABEL = "lienzo-visuals";

/** ¿Es el host del marco de los visuales? (con o sin puerto, en minúsculas). */
export function isVisualsHost(host: string | null | undefined): boolean {
  const nombre = String(host ?? "").trim().toLowerCase().replace(/:\d+$/, "");
  return nombre.includes(".") && nombre.split(".")[0] === VISUALS_LABEL;
}
