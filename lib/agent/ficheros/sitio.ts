/**
 * EL SITIO, VISTO COMO FICHEROS (Len 2.0 — plans/len-2/ficheros-plan.md).
 *
 * Len trabaja como Claude Code: con rutas y el contenido tal cual, sin ids
 * inyectados ni un vocabulario nuestro. El árbol es el MISMO que escribe
 * `publishToDir` —`index.html` para la home y `<slug>/index.html` por página—,
 * así que lo que Len lee es lo que se publica.
 *
 * Los ficheros NO están en disco: viven en Postgres (`project.data.html` y
 * `data.pages`). Esto sólo sabe nombrarlos. Escribirlos pasa por el camino de
 * guardado de siempre (`lib/page-engine`), nunca por aquí.
 *
 * Sin más import que `len-md.ts`, puro también: lo prueba vitest sin binding
 * nativo ni base.
 */
import { HOME_DIR } from "./len-md";

/** La carpeta de trabajo: la raíz del sitio. Es la que Claude Code le
 *  recuerda al modelo cuando busca un fichero que no está. */
export const CWD = "/";

const INDICE = "index.html";

/** Lo mínimo que hace falta del proyecto para verlo como ficheros. */
export interface SitioDeDatos {
  readonly html?: string | null;
  readonly pages?: Readonly<Record<string, { readonly html?: string | null } | undefined>> | null;
}

/**
 * Un proyecto anterior al 2026-08-23 pudo guardar `data-op-id` dentro de su
 * HTML. Len 2.0 no trabaja con ids: no se le enseñan. Es la misma limpieza que
 * hace el publicador (`stripOpIds`), sin el binding. Vive aquí, en lo puro,
 * porque la usan también el bucle y la ruta: el fichero que ve Read es uno.
 */
export function sinOpIds(html: string): string {
  return html.includes("data-op-id") ? html.replace(/\sdata-op-id="[^"]*"/g, "") : html;
}

/** La ruta del fichero de una página: `null` es la home. */
export function rutaDePagina(page: string | null): string {
  return page ? `/${page}/${INDICE}` : `/${INDICE}`;
}

/**
 * La ruta absoluta y normalizada, como en Claude Code: una relativa se
 * resuelve contra la raíz, se aceptan barras invertidas, y `.`/`..` se pliegan.
 */
export function resolverRuta(filePath: string): string {
  // `~` es el HOME de la terminal (`len-md.ts`), como en bash.
  const expandida = filePath === "~" || filePath.startsWith("~/") ? HOME_DIR + filePath.slice(1) : filePath;
  const partes: string[] = [];
  for (const trozo of expandida.replace(/\\/g, "/").split("/")) {
    if (trozo === "" || trozo === ".") continue;
    if (trozo === "..") {
      partes.pop();
      continue;
    }
    partes.push(trozo);
  }
  return "/" + partes.join("/");
}

/** La página que guarda un fichero, o `null` si la ruta no es de un fichero
 *  del sitio. No dice si EXISTE: sólo si su forma es la de una página. */
export function paginaDeRuta(ruta: string): { page: string | null } | null {
  const partes = resolverRuta(ruta).split("/").slice(1);
  if (partes.length === 1 && partes[0] === INDICE) return { page: null };
  if (partes.length === 2 && partes[1] === INDICE && partes[0]) return { page: partes[0] };
  return null;
}

/** Los ficheros que existen: la home primero y las páginas por orden de slug. */
export function ficherosDelSitio(data: SitioDeDatos): string[] {
  const rutas: string[] = [];
  if (typeof data.html === "string" && data.html !== "") rutas.push(rutaDePagina(null));
  const slugs = Object.keys(data.pages ?? {})
    .filter((slug) => typeof data.pages?.[slug]?.html === "string")
    .sort();
  for (const slug of slugs) rutas.push(rutaDePagina(slug));
  return rutas;
}

/** El contenido de un fichero, o `null` si no existe. */
export function leerFichero(data: SitioDeDatos, ruta: string): string | null {
  const donde = paginaDeRuta(ruta);
  if (!donde) return null;
  if (donde.page === null) {
    return typeof data.html === "string" && data.html !== "" ? data.html : null;
  }
  const html = data.pages?.[donde.page]?.html;
  return typeof html === "string" ? html : null;
}

/**
 * Dónde busca Grep o Glob cuando les dan un `path`: una carpeta (la raíz o la
 * de una página) con los ficheros que cuelgan de ella, un fichero suelto, o
 * `null` si no existe. Las carpetas no se guardan en ningún sitio: son las que
 * hacen falta para que existan los ficheros.
 */
export function alcanceDeBusqueda(
  path: string | undefined,
  existentes: readonly string[],
): { readonly carpeta: string; readonly ficheros: readonly string[] } | { readonly fichero: string } | null {
  const ruta = resolverRuta(path ?? CWD);
  if (existentes.includes(ruta)) return { fichero: ruta };
  const prefijo = ruta === "/" ? "/" : `${ruta}/`;
  const dentro = existentes.filter((f) => f.startsWith(prefijo));
  if (ruta !== "/" && dentro.length === 0) return null;
  return { carpeta: ruta, ficheros: dentro };
}

/** La ruta como la enseña Claude Code en los resultados de búsqueda: relativa
 *  a la carpeta de trabajo (`index.html`, `menu/index.html`). */
export function rutaRelativa(ruta: string): string {
  return ruta.startsWith(CWD) ? ruta.slice(CWD.length) : ruta;
}

/** Nombres con los que se suele llamar a la home y que no son una página. */
const ALIAS_DE_LA_HOME = new Set(["home", "inicio", "principal", "index"]);

/**
 * El fichero que seguramente se quiso decir, para sugerirlo como hace Claude
 * Code cuando no encuentra uno. Él busca un fichero con el mismo nombre en la misma carpeta; aquí
 * las equivocaciones que de verdad pasan son otras —`/menu.html`, `/menu`, una
 * mayúscula, llamar «home» a la home— y se contestan con lo que existe.
 */
export function sugerirRuta(ruta: string, existentes: readonly string[]): string | undefined {
  const partes = resolverRuta(ruta).toLowerCase().split("/").filter(Boolean);
  if (partes[partes.length - 1] === INDICE) partes.pop();
  const ultima = partes.pop();
  if (partes.length > 0 || ultima === undefined) return undefined;
  const slug = ultima.replace(/\.html?$/, "");
  const candidata = ALIAS_DE_LA_HOME.has(slug) ? rutaDePagina(null) : rutaDePagina(slug);
  if (candidata === resolverRuta(ruta)) return undefined;
  return existentes.includes(candidata) ? candidata : undefined;
}
