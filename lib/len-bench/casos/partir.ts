// lib/len-bench/casos/partir.ts — de una plantilla de UNA página, un sitio de
// varias: la misma cabecera y el mismo pie en todas, y cada trozo en su página.
//
// Los `href="#seccion"` que al partir quedan en OTRA página se reescriben a
// `/pagina/#seccion` (o `/#seccion` si quedó en la home): si no, el menú de la
// plantilla sería una fila de botones muertos EN LA PARTIDA, y un defecto de
// la partida no es del encargo (lección de `sitio-que-se-muda`, 23/09).
// Y los ayudantes para editar un sitio entero con `cambiar`.
// Vivía en plans/len-2/pendientes/; se mudó al repo al repartir (D1): lo
// importan casos de dev y del sellado, que ya no están al lado.
import type { ProjectData } from "@/lib/projects/types";
import { cambiar, type Cambio } from "./cambiar";

export interface Corte {
  /** "" es la home. */
  readonly slug: string;
  readonly title: string;
  /** Los trozos de la plantilla que van en esta página, en orden: cada uno,
   *  de la marca donde empieza (un comentario, p. ej.) a la marca donde acaba. */
  readonly trozos: readonly (readonly [desde: string, hasta: string])[];
}

function en(html: string, marca: string): number {
  const i = html.indexOf(marca);
  if (i < 0) throw new Error(`la plantilla ya no trae «${marca}»`);
  return i;
}

export function partirEnPaginas(plantilla: string, o: { cabeceraHasta: string; pieDesde: string; paginas: readonly Corte[] }): ProjectData {
  const cabeza = plantilla.slice(0, en(plantilla, o.cabeceraHasta));
  const pie = plantilla.slice(en(plantilla, o.pieDesde));
  const cuerpos = o.paginas.map((c) => ({
    ...c,
    cuerpo: c.trozos.map(([desde, hasta]) => plantilla.slice(en(plantilla, desde), en(plantilla, hasta))).join(""),
  }));
  // En qué página quedó cada id.
  const dondeEsta = new Map<string, string>();
  for (const c of cuerpos) for (const m of c.cuerpo.matchAll(/\bid="([^"]+)"/g)) dondeEsta.set(m[1], c.slug);
  const pagina = (c: (typeof cuerpos)[number]) =>
    (cabeza + c.cuerpo + pie).replace(/href="#([^"]+)"/g, (todo, id: string) => {
      const slug = dondeEsta.get(id);
      if (slug === undefined || slug === c.slug) return todo;
      return `href="${slug === "" ? "/" : `/${slug}/`}#${id}"`;
    });
  const home = cuerpos.find((c) => c.slug === "");
  if (!home) throw new Error("falta la home (slug «»)");
  return {
    html: pagina(home),
    pages: Object.fromEntries(cuerpos.filter((c) => c.slug !== "").map((c) => [c.slug, { title: c.title, html: pagina(c) }])),
  };
}

/** El mismo cambio en todas las páginas del sitio (cada una con su cuenta). */
export function enTodas(d: ProjectData, cambios: readonly Cambio[]): ProjectData {
  return {
    html: cambiar(d.html, cambios),
    pages: Object.fromEntries(Object.entries(d.pages ?? {}).map(([s, p]) => [s, { ...p, html: cambiar(p.html, cambios) }])),
  };
}

/** Un cambio en UNA página del sitio ("" es la home). */
export function enPagina(d: ProjectData, slug: string, cambios: readonly Cambio[]): ProjectData {
  if (slug === "") return { ...d, html: cambiar(d.html, cambios) };
  const p = d.pages?.[slug];
  if (!p) throw new Error(`no hay página «${slug}»`);
  return { ...d, pages: { ...d.pages, [slug]: { ...p, html: cambiar(p.html, cambios) } } };
}
