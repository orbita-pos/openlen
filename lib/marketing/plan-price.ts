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
//
// 04/10: los planes de pago pasan a DOS, Pro $10 y Max $20 (Jesús: «vender a
// mayoreo», como los planes de Claude y OpenAI). Los créditos de aquí son los
// que da el cobro: `CREDITS_BY_PLAN` (lib/credits.ts) los lee de este fichero.
// El PRECIO lo cobra Polar (un producto por plan: POLAR_PRODUCT_PRO_ID y
// POLAR_PRODUCT_MAX_ID) y va en prosa en los Términos, el reembolso y la
// documentación: cambiar un precio es cambiar Polar y esas tres páginas.
export const PRO_PRICE = 10;
export const PRO_CREDITS = 200;

export const MAX_PRICE = 20;
export const MAX_CREDITS = 500;

/** El precio anterior, para tacharlo.
 *
 *  `null`: con Pro a $10 no hay rebaja que anunciar. Un tachado tiene que ser
 *  un precio realmente aplicado (directiva Omnibus de la UE; Polar vende dentro
 *  de la UE como merchant of record), y $10 es más, no menos, que los $7 y los
 *  $3.99 de antes. */
export const PRO_WAS: number | null = null;

/** Calculado, nunca escrito a mano: un porcentaje literal se queda viejo en
 *  cuanto se toca un precio, y un descuento que no cuadra con sus propias cifras
 *  es el peor tipo de error en una página de precios. */
export const PRO_SAVE_PERCENT =
  PRO_WAS === null ? 0 : Math.round(((PRO_WAS - PRO_PRICE) / PRO_WAS) * 100);

/** Centavos por crédito de cada plan, para decir cuál sale más barato sin
 *  escribir el número a mano. */
export const centsPerCredit = (price: number, credits: number) =>
  Math.round((price / credits) * 1000) / 10;
