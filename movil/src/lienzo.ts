// El prototipo está dibujado en un lienzo de 390 × 844 con posiciones en px.
// En el teléfono se escala al ancho de la pantalla y se estira de alto: lo de
// arriba queda donde está y lo de abajo (los botones de la llamada) baja con
// el borde. Si la pantalla es más ancha que alta en proporción, manda el alto.
export const ANCHO_DEL_LIENZO = 390;
export const ALTO_DEL_LIENZO = 844;

export function medidasDelLienzo(ancho: number, alto: number): { escala: number; alto: number } {
  const porAncho = ancho / ANCHO_DEL_LIENZO;
  if (alto / porAncho >= ALTO_DEL_LIENZO) return { escala: porAncho, alto: Math.round(alto / porAncho) };
  return { escala: alto / ALTO_DEL_LIENZO, alto: ALTO_DEL_LIENZO };
}
