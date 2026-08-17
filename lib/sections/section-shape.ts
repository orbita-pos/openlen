/**
 * Lo que una sección ES, leído de su marcado y no de su etiqueta.
 *
 * El extractor de bandas rotuló como `hero` la banda 0 de cada plantilla, y en
 * casi toda plantilla la banda 0 es la barra de navegación: medido, 343 de 506
 * heroes publicados son barras, todos de ordinal 0. El composer las elegía como
 * hero y la página salía con DOS navbars, la segunda con el brief volcado
 * dentro de sus enlaces.
 *
 * La prueba es de forma, no de nombre: una barra no tiene titular, tiene un
 * `<nav>` y es casi toda enlaces. Un hero de verdad afirma algo.
 */

/** El marcado sin sus hojas de estilo ni sus fuentes. */
export function sectionMarkup(body: string): string {
  return body
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<link\b[^>]*>/gi, "")
    .trim();
}

/**
 * ¿Este marcado es una barra de navegación?
 *
 * Conservador a propósito: exige las tres señales a la vez, porque un falso
 * positivo retira una sección buena del catálogo y eso cuesta variedad.
 */
export function looksLikeNavbar(body: string): boolean {
  const markup = sectionMarkup(body);
  if (!markup) return false;
  if (/<h[1-3]\b/i.test(markup)) return false;
  if (!/<nav\b/i.test(markup)) return false;
  return (markup.match(/<a\b/gi) ?? []).length >= 3;
}
