// LAS PÁGINAS QUE LA PROPIA PORTADA DICE QUE EXISTEN.
//
// EL FALLO. Le pedías a OpenLen «una web con inicio, servicios y contacto» y te
// daba UNA página. No era un bug del código: el contrato le decía al modelo
// «Output a COMPLETE, self-contained HTML document» y, en el apartado de
// enlaces, que una ruta relativa se rompe en silencio y que sin destino use
// `href="#"`. El modelo hacía exactamente lo que se le mandaba — medido en el
// corpus del repo, todas las navegaciones generadas son anclas (`#servicios`).
// Y `createProject` sólo sabe escribir `data.html`; `data.pages` no lo tocaba
// nadie desde la generación.
//
// LA SALIDA, sin una llamada de más. El contrato cambia: cuando el sitio
// necesita páginas de verdad, el menú las enlaza con una ruta relativa de un
// tramo (`/servicios`) y esa página SE CREA. Así que quién decide cuántas
// páginas hay es el MODELO, en el documento que ya escribió — no una regex
// sobre el brief ni una llamada extra para preguntárselo.
//
// Y de paso cierra un agujero viejo: hasta hoy una ruta relativa en la
// navegación servía la portada otra vez con un 200, sin 404 y sin aviso
// ([[caddy-broken-links-serve-home]]). Ahora la ruta existe.

import { validatePageSlug } from "@/lib/projects/site-pages";

/** Cuántas páginas se aceptan además de la portada. El contrato pide cuatro;
 *  esto es el cinturón por si el modelo se entusiasma. Nada se rechaza por
 *  pasarse: se cogen las primeras, en el orden en que aparecen en el menú, que
 *  es el orden en que el modelo las pensó. */
export const MAX_PAGINAS_DECLARADAS = 4;

export interface PaginaDeclarada {
  readonly slug: string;
  /** El texto del enlace, que es como el modelo llamó a la página. */
  readonly title: string;
}

/** `<a … href="…" …>texto</a>` — el href y el texto de dentro, en orden de
 *  aparición. Sin parser: es una lectura, no una transformación, y meter el
 *  documento del usuario en un DOM para leerlo lo normalizaría entero. */
const ENLACE_RE = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const HREF_RE = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i;

/**
 * Las páginas que esta portada enlaza y que habría que crear.
 *
 * Sólo rutas relativas de UN tramo con barra inicial. Todo lo demás se queda
 * fuera, y cada exclusión tiene su razón:
 *
 * - `#seccion` es una sección de esta misma página, que es la respuesta por
 *   defecto y la más común.
 * - `https://…`, `mailto:`, `tel:` son destinos de fuera.
 * - `/tienda/camisas` tiene dos tramos: el modelo de páginas es plano
 *   (`ProjectData.pages` es `Record<slug, …>`), así que una ruta anidada no
 *   tiene dónde vivir y crearla a medias sería peor que no crearla.
 * - Un slug que `validatePageSlug` rechaza —reservado, con forma rara— tampoco
 *   entra: son las mismas reglas que el botón «Nueva página», y tener dos
 *   criterios de qué es un slug válido es cómo se acaba con una página que
 *   existe en la base de datos y no se puede publicar.
 */
export function paginasDeclaradas(homeHtml: string): PaginaDeclarada[] {
  const vistos = new Set<string>();
  const salida: PaginaDeclarada[] = [];

  for (const m of homeHtml.matchAll(ENLACE_RE)) {
    if (salida.length >= MAX_PAGINAS_DECLARADAS) break;
    const attrs = m[1] ?? "";
    const href = HREF_RE.exec(attrs);
    if (!href) continue;
    const destino = (href[2] ?? href[3] ?? href[4] ?? "").trim();
    // Un tramo, con barra delante y sin barra dentro. La barra final se
    // tolera —`/servicios/` es la misma página— y se cae en el validador.
    if (!/^\/[^/#?\s]+\/?$/.test(destino)) continue;

    const chequeo = validatePageSlug(destino);
    if (!chequeo.ok) continue;
    if (vistos.has(chequeo.slug)) continue;

    // El texto del enlace, sin las etiquetas de dentro (un menú suele traer un
    // <span> o un icono) y sin espacios de sobra. Si no queda nada legible, el
    // slug hace de título — es lo que hace `crear_pagina` cuando sólo tiene uno.
    const texto = (m[2] ?? "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

    vistos.add(chequeo.slug);
    salida.push({ slug: chequeo.slug, title: texto || chequeo.slug });
  }

  return salida;
}
