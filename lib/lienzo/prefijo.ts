// LO DEL HOST DEL LIENZO QUE SE PUEDE IMPORTAR EN CUALQUIER SITIO.
//
// `host.ts` usa `node:crypto` desde la pieza 9 de Len 2.5 (la etiqueta es un
// HMAC del id), así que ya no puede entrar en el cliente ni en el middleware,
// que corre en el borde. Lo que necesitan los dos —el prefijo
// (`lib/subdomain/validate.ts`) y leer la etiqueta de un host
// (`lib/lienzo/site-rewrite.ts`, desde `middleware.ts`)— vive aquí, puro.

export const LIENZO_PREFIJO = "lienzo-";

/** La etiqueta de lienzo del primer tramo de un host, o null si no lo es. */
export function etiquetaDelHost(host: string | null | undefined): string | null {
  const nombre = String(host ?? "").trim().toLowerCase().replace(/:\d+$/, "");
  if (!nombre.includes(".")) return null;
  const primera = nombre.split(".")[0] ?? "";
  return /^lienzo-[0-9a-f]{32}$/.test(primera) ? primera : null;
}
