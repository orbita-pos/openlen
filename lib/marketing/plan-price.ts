// El precio del plan Pro, en UN sitio.
//
// POR QUÉ EXISTE ESTE FICHERO. El precio ya vivía en cuatro sitios —la tarjeta,
// los Términos, la política de reembolso y la documentación— y el 2026-08-29
// estuvo a punto de vivir en catorce: la celda de la tabla comparativa lo
// llevaba escrito dentro de la cadena traducida, así que bajar el precio habría
// significado editar diez ficheros de idioma y acordarse de los diez.
//
// Las tres páginas de prosa no tienen arreglo —el importe va dentro de una
// frase legal— pero todo lo que PINTA el precio lee de aquí.
export const PRO_PRICE = 3.99;

/** El precio anterior, para tacharlo.
 *
 *  ES REAL: $7 fue el precio publicado hasta el 2026-08-29, en la landing y en
 *  los Términos. Eso es lo que permite anunciarlo como rebaja — la directiva
 *  Omnibus de la UE exige que un precio tachado sea uno realmente aplicado, y
 *  Polar vende dentro de la UE como merchant of record.
 *
 *  ⚠️ CADUCA. Un descuento que no termina nunca deja de ser un descuento.
 *  Cuando $3.99 sea simplemente el precio, esto se pone a `null` y la tarjeta
 *  vuelve a tener un solo número. */
export const PRO_WAS: number | null = 7;

/** Calculado, nunca escrito a mano: un 43% literal se queda viejo en cuanto se
 *  toca un precio, y un descuento que no cuadra con sus propias cifras es el
 *  peor tipo de error en una página de precios. */
export const PRO_SAVE_PERCENT =
  PRO_WAS === null ? 0 : Math.round(((PRO_WAS - PRO_PRICE) / PRO_WAS) * 100);
