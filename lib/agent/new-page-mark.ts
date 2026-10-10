// La marca de una página recién creada en el resumen de su tarjeta
// (`action.summary`): «clases/index.html (página nueva)». La escribe el
// servidor (herramientas-de-ficheros.ts) y la tarjeta la dice en el idioma de
// quien mira (`summaryLabel`). Las filas guardadas la llevan con este texto
// desde Len 2.0, por eso el dato no cambia: cambia cómo se pinta.

export const NEW_PAGE_MARK = " (página nueva)";

/** ¿Es una página del sitio? `index.html` o `<slug>/index.html`, ruta relativa
 *  como la de la tarjeta (la misma regla que `paginaDeRuta`). */
export function isPagePath(relativePath: string): boolean {
  return /^(?:[^/\s]+\/)?index\.html$/.test(relativePath);
}
