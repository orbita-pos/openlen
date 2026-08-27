// De «la portada dice que hay una página de Servicios» a la página que existe.
//
// Junta las dos piezas que ya estaban y no se hablaban: `paginasDeclaradas`
// —que lee del propio documento cuántas páginas decidió el modelo— y
// `buildPageShell` —que viste una página nueva con la cabecera, el menú, el pie
// y los tokens de la portada—. Ésta es la misma función que usa el botón
// «Nueva página» desde 2026-06, así que una página nacida aquí es
// indistinguible de una creada a mano: mismo look, misma temática, mismo <head>.
//
// FAIL-SOFT, A PROPÓSITO. Si la portada no parsea, o un slug no pasa, la página
// simplemente no se crea y la generación sigue: el usuario se queda con su
// portada, que es lo que vino a buscar. Perder la generación entera por una
// subpágina sería cambiar un fallo pequeño por uno grande.

import {
  MAX_PAGINAS_DECLARADAS,
  paginasDeclaradas,
} from "@/lib/projects/paginas-declaradas";
import { buildPageShell } from "@/lib/projects/site-pages";
import type { SitePage } from "@/lib/projects/types";

export { MAX_PAGINAS_DECLARADAS };

/**
 * Las páginas que hay que guardar junto a esta portada, vestidas y vacías.
 *
 * Vacías HOY: cada una trae el menú, el pie y el look de la portada, y en medio
 * un héroe con su título y una frase que invita a editarla. Es exactamente lo
 * que el botón «Nueva página» entrega, y es lo que hace falta para que el menú
 * que el modelo escribió lleve a algún sitio en vez de servir la portada otra
 * vez con un 200 — que es lo que pasaba hasta hoy, sin 404 y sin aviso.
 *
 * Devuelve `{}` cuando no hay nada que crear, que es el caso NORMAL: casi todo
 * cabe en una sola página, el modelo enlaza sus secciones con anclas, y de ahí
 * no sale ninguna página nueva.
 */
export function construirPaginasDeclaradas(
  homeHtml: string,
): Record<string, SitePage> {
  const declaradas = paginasDeclaradas(homeHtml);
  if (declaradas.length === 0) return {};

  const paginas: Record<string, SitePage> = {};
  for (const { slug, title } of declaradas) {
    const html = buildPageShell(homeHtml, title);
    // `buildPageShell` devuelve null cuando el documento no tiene <body> — un
    // caso que no debería llegar aquí (el documento ya pasó por el saneador),
    // pero si llega, esta página se queda sin crear y las demás siguen.
    if (!html) continue;
    paginas[slug] = { html, title };
  }
  return paginas;
}
