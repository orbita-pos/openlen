// EN UN HOST LIENZO SÓLO RESPONDE EL LIENZO (pieza 9 de Len 2.5).
//
// `lienzo-<etiqueta>.<dominio>` sirve el sitio entero del borrador: la página
// en la ruta que tendrá publicada y los ficheros de la carpeta (`/js/app.js`).
// El middleware manda TODO lo de ese host a `app/api/lienzo/site/…`; ninguna
// página de la app (el login, el taller) se pinta en un origen donde corre el
// JavaScript del dueño. Lo único que no se toca son las rutas del propio
// lienzo (`/api/lienzo/<docId>`, la forma vieja de la URL, y la del sitio).
//
// Puro y sin `node:crypto`: corre en el middleware, en el borde.

import { etiquetaDelHost } from "./prefijo";

export const LIENZO_SITE_ROUTE = "/api/lienzo/site";

/** A dónde reescribir la ruta, o `null` si no se toca. */
export function lienzoRewrite(host: string | null, pathname: string): string | null {
  if (!etiquetaDelHost(host)) return null;
  if (pathname === "/api/lienzo" || pathname.startsWith("/api/lienzo/")) return null;
  return pathname === "/" ? LIENZO_SITE_ROUTE : `${LIENZO_SITE_ROUTE}${pathname}`;
}
