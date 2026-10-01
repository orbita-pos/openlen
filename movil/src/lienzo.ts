// El prototipo está dibujado en un lienzo de 390 × 844 con posiciones en px.
// En el teléfono se escala al ancho de la pantalla y el alto se ajusta: lo de
// arriba queda donde está y lo de abajo (los botones, la hoja) va con el borde.
// Llena SIEMPRE el ancho, aunque el lienzo quede más bajo que 844: con la barra
// de Chrome un Galaxy A07 deja 384 × 725, y la regla vieja («nunca menos de
// 844») lo encogía y dejaba una franja vacía a la derecha. Sólo con el teléfono
// ACOSTADO, si quedara más bajo que 700, manda el alto y el lienzo va centrado.
// De pie, nunca: el teclado encoge el alto (el chat) y la app debe quedarse del
// mismo ancho, sólo más baja — si no, al escribir se achicaba entera.
export const ANCHO_DEL_LIENZO = 390;
export const ALTO_DEL_LIENZO = 844;
export const ALTO_MINIMO = 700;

export function medidasDelLienzo(ancho: number, alto: number, acostado = ancho > alto): { escala: number; alto: number; izquierda: number } {
  const porAncho = ancho / ANCHO_DEL_LIENZO;
  if (!acostado || alto / porAncho >= ALTO_MINIMO) return { escala: porAncho, alto: Math.round(alto / porAncho), izquierda: 0 };
  const escala = alto / ALTO_MINIMO;
  return { escala, alto: ALTO_MINIMO, izquierda: Math.round((ancho - ANCHO_DEL_LIENZO * escala) / 2) };
}
