// EN UN HOST LIENZO SÓLO RESPONDE EL LIENZO (pieza 9 de Len 2.5).
//
// `lienzo-<etiqueta>.<dominio>` sirve el sitio entero del borrador: la página
// en la ruta que tendrá publicada y los ficheros de la carpeta (`/js/app.js`).
// TODO lo de ese host va a `app/api/lienzo/site/…`; ninguna página de la app
// (el login, el taller) se pinta en un origen donde corre el JavaScript del
// dueño. Lo único que no se toca son las rutas del propio lienzo
// (`/api/lienzo/<docId>`, la forma vieja de la URL, y la del sitio).
//
// 🔴 SON `rewrites` DE next.config, NO DEL MIDDLEWARE. Medido en producción el
// 06/10/2026: con `NextResponse.rewrite(new URL(destino, req.url))` en el
// middleware, TODO host lienzo daba 500 en la caja. Next escribe `127.0.0.1`
// como `localhost` en la URL que ve el middleware (`NextURL`), su router
// compara la reescritura con su propio origen —`127.0.0.1`, el `HOSTNAME` de
// `infra/app/openlen-app.service`— y, al no ser el mismo, la trata como
// EXTERNA: se hace proxy a sí mismo por https (el `X-Forwarded-Proto` de
// Caddy) contra un puerto que habla http («Failed to proxy … EPROTO»). En
// desarrollo los dos dicen `localhost`, y por eso pasaba. Un `rewrite` de
// next.config lo resuelve el router por dentro, sin comparar orígenes.
//
// Sin imports: lo carga next.config.ts.

export const LIENZO_SITE_ROUTE = "/api/lienzo/site";

// Next lo compara anclado y contra el host sin puerto, en minúsculas. Es la
// misma etiqueta que lee `etiquetaDelHost` (`prefijo.ts`).
const EN_UN_HOST_LIENZO = [{ type: "host" as const, value: "lienzo-[0-9a-f]{32}\\..*" }];

/** Para `rewrites().beforeFiles`: antes que `public/`, para que tampoco
 *  `/favicon.ico` sea el de la app. */
export const LIENZO_REWRITES = [
  { source: "/", has: EN_UN_HOST_LIENZO, destination: LIENZO_SITE_ROUTE },
  {
    source: "/:ruta((?!api/lienzo(?:/|$)).+)",
    has: EN_UN_HOST_LIENZO,
    destination: `${LIENZO_SITE_ROUTE}/:ruta`,
  },
];
