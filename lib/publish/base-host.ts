// El dominio donde viven las páginas publicadas — la copia que ve el navegador.
//
// DOS VARIABLES, Y NO ES DUPLICACIÓN:
//
//   PUBLISH_BASE_HOST              manda. La lee el servidor en tiempo de
//                                  ejecución (`/etc/openlen/openlen.env`) y
//                                  decide dónde NACE una página, qué origen
//                                  firma los formularios y qué URL devuelve la
//                                  API al publicar.
//   NEXT_PUBLIC_PUBLISH_BASE_HOST  es su copia horneada en el bundle, y es lo
//                                  único que puede leer un componente de
//                                  cliente. Sólo sirve para PINTAR.
//
// El bundle se compila en el portátil y se despliega a un box cuyo entorno es
// la fuente de verdad, así que las dos tienen que decir lo mismo: el gate
// `publish-host:gate` del deploy aborta si la pública falta.
//
// POR QUÉ EXISTE ESTE FICHERO. El 2026-08-23 se puso PUBLISH_BASE_HOST=
// openlen.app en producción y las páginas empezaron a nacer allí — pero la
// interfaz entera seguía diciendo openlen.com: el menú Publicar, el sufijo del
// diálogo, la barra de estado, la barra de dirección falsa del streaming y el
// destino del CNAME. No estaba roto (los dos dominios sirven las mismas
// carpetas), pero el `.app` era invisible y el sistema se contradecía a sí
// mismo. Eran ~15 literales a mano repartidos por la interfaz y 8 cadenas
// traducidas en 10 idiomas. Ahora es una variable.

/** El dominio que se PINTA. `openlen.com` si nadie dice otra cosa. */
export const PUBLISHED_BASE_HOST: string =
  process.env.NEXT_PUBLIC_PUBLISH_BASE_HOST?.trim() || "openlen.com";

/** `mitienda` → `mitienda.openlen.app`. */
export function publishedHost(sub: string): string {
  return `${sub}.${PUBLISHED_BASE_HOST}`;
}

/** `mitienda` → `https://mitienda.openlen.app`. `path` entra tal cual. */
export function publishedUrl(sub: string, path = ""): string {
  return `https://${publishedHost(sub)}${path}`;
}

/**
 * Sufijos que NO se aceptan como dominio propio.
 *
 * Los DOS, siempre, sin mirar la variable: mientras `openlen.com` y
 * `openlen.app` sirvan las mismas carpetas, aceptar `x.openlen.app` como
 * "dominio propio" sería dejar que alguien reclame por la puerta de atrás lo
 * que la puerta de delante rechaza. Es el mismo razonamiento que
 * `publishedBaseHosts()` en `request-origin.ts`.
 */
export const RESERVED_BASE_SUFFIXES: readonly string[] = [
  ".openlen.com",
  ".openlen.app",
];
