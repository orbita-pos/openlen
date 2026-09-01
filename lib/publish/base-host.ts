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

const MARCAS_COMBINANTES = /[̀-ͯ]/g;

/**
 * `Tacos El Güero` → `tacos-el-guero`. El slug que se PROPONE como subdominio.
 *
 * POR QUÉ EXISTE. Estaba escrita tres veces y las tres contestaban distinto al
 * mismo nombre: la barra de dirección falsa del streaming no normalizaba nada
 * (`tacos-el-g-ero`), el diálogo de dominio propio hacía `NFKD` pero NO quitaba
 * la marca combinante, así que la convertía en guión (`tacos-el-gu-ero`), y
 * sólo `create-page.ts` acertaba. La que veía el usuario era la peor de las
 * tres. Mismo patrón que las listas de dominios de más abajo: cada una era
 * defendible por separado, y juntas se contradecían.
 *
 * A QUIÉN LE PASABA: a casi todo nombre hispanohablante. `Panadería` →
 * `panader-a`, `Peña` → `pe-a`, `Niño` → `ni-o`, `Café` → `caf-`.
 *
 * POR QUÉ NO HAY MAPA ALEMÁN. `ä ö ü` → `ae oe ue` es la convención alemana,
 * pero aplicada a ciegas DESTROZA el español: `Güero` → `gueero`, `Pingüino` →
 * `pingueino`, `Vergüenza` → `vergueenza`. La misma letra no se translitera
 * igual en los dos idiomas y aquí no sabemos en cuál estamos, así que la `ü`
 * cae por NFD como cualquier otra tilde. El alemán queda en `muller` en vez de
 * `mueller`: legible y sin ambigüedad, que es lo que pide un subdominio.
 * La `ß` es la excepción porque SÓLO existe en alemán — no hay nada que
 * romper — y sin ella `Straße` se quedaba en `stra-e`, roto incluso tras NFD.
 *
 * JAPONÉS, COREANO Y CHINO devuelven cadena vacía A PROPÓSITO, y quien llama
 * decide el reemplazo (hoy `p-<id8>`). Romanizar 寿司 es un problema de
 * diccionario, no de expresión regular, y un subdominio equivocado es peor que
 * uno anónimo.
 */
export function subdomainFromTitle(title: string, maxChars = 40): string {
  const completo = title
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(MARCAS_COMBINANTES, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return recortarPorPalabra(completo, maxChars);
}

/**
 * Corta a `maxChars` SIN partir una palabra por la mitad.
 *
 * El corte a pelo era la otra mitad de lo que se veía mal en producción:
 * «…Taquería en Guadalajara» a 28 caracteres daba `…-taqueria-en-g`, con esa
 * `g` huérfana que parece un error aunque sea un subdominio válido. Retrocede
 * al último guión, pero sólo si deja al menos la mitad del presupuesto — si no,
 * una primera palabra larguísima se comería el nombre entero.
 */
function recortarPorPalabra(slug: string, maxChars: number): string {
  if (slug.length <= maxChars) return slug;
  const cortado = slug.slice(0, maxChars);
  const partePalabra = slug[maxChars] !== "-";
  const ultimoGuion = cortado.lastIndexOf("-");
  if (partePalabra && ultimoGuion >= Math.floor(maxChars / 2)) {
    return cortado.slice(0, ultimoGuion);
  }
  return cortado.replace(/-+$/g, "");
}

/**
 * LOS DOMINIOS DONDE OPENLEN SIRVE PÁGINAS. Fuente única.
 *
 * Todo lo demás se deriva de aquí: qué procedencia se acepta en los endpoints
 * públicos (`request-origin.ts`), qué no se puede reclamar como dominio propio
 * (`custom-domains.ts`) y qué sufijo rechaza el formulario del navegador.
 *
 * POR QUÉ ES UNA SOLA LISTA. Estaba escrita cuatro veces, y el 2026-08-23 se
 * añadió `openlen.app` a una de ellas. Al día siguiente `mitienda.openlen.app`
 * todavía se podía reclamar como dominio propio, porque la lista de
 * `custom-domains.ts` no se había enterado. Nadie lo habría visto: las dos
 * listas eran correctas por separado.
 *
 * Es distinta de `PUBLISHED_BASE_HOST`: ésa dice dónde NACE una página nueva y
 * cambia con el entorno. Ésta dice qué dominios son NUESTROS, y no depende de
 * ninguna variable — mientras un dominio sirva páginas, cuenta, esté o no
 * configurado como el principal.
 */
export const OPENLEN_PAGE_HOSTS: readonly string[] = ["openlen.com", "openlen.app"];

/** `.openlen.com`, `.openlen.app`. Derivado, nunca escrito a mano. */
export const RESERVED_BASE_SUFFIXES: readonly string[] = OPENLEN_PAGE_HOSTS.map(
  (h) => `.${h}`,
);
