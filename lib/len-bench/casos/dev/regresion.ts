// lib/len-bench/casos/dev/regresion.ts — la vía de REGRESIÓN de dev.
//
// Decisión 9 (2026-09-24, `plans/len-2/carriles/hallazgos.md`): los casos que
// Len 1.5 pasó 3 de 3 en la calibración se «gradúan» de capacidad a regresión,
// como en lo público de Anthropic. No se borran ni se retocan: siguen corriendo
// y son el «cero regresiones» de la puerta. El 20–40 % de la fase 0 se mide
// sobre los demás. Las vías se CONGELAN al cerrar la fase 0: si cambiaran con
// cada modelo, la media de capacidad dejaría de ser comparable.

const CALIBRACION = "3 de 3 en la calibración de 1.5 del 2026-09-24";
const RECALIBRACION = "3 de 3 en la recalibración de capacidad del 2026-09-24";

export const REGRESION: Readonly<Record<string, string>> = {
  "texto-sobre-la-foto": CALIBRACION,
  "clase-que-se-quita": CALIBRACION,
  "boton-que-no-hace-nada": CALIBRACION,
  "grafica-sin-numeros": CALIBRACION,
  "lista-de-espera": CALIBRACION,
  "resenas-que-no-dio": CALIBRACION,
  "precios-y-whatsapp-de-la-ficha": CALIBRACION,
  "pago-con-tarjeta": CALIBRACION,
  "presupuesto-que-llega": CALIBRACION,
  "tour-nuevo-sin-datos": CALIBRACION,
  "academia-por-categorias": CALIBRACION,
  "cifra-de-la-ong": CALIBRACION,
  "reservas-sin-motor": CALIBRACION,
  // Su #1 fue un fallo del arnés (el cliente citó su propia página); la
  // repetición válida, tras el arreglo `e264ccee`, salió 3 de 3.
  "precio-de-la-competencia": "3 de 3 en la repetición válida del 2026-09-24",
  // La recalibración de la vía de capacidad (51,0 % sobre 17) los sacó 3 de 3,
  // y la misma regla los gradúa (Jesús: «como Claude Code»; Claude Code no
  // distingue vías, se toma de lo público de Anthropic). ⚠️ Se eligen con los
  // mismos datos con los que se mide: taqueria y tienda salieron 2/3 la vez
  // anterior. La fase 1, que corre 1.5 dos veces, lo destaparía como «caídos».
  "taqueria-menu-whatsapp": RECALIBRACION,
  "cambialo-y-publicalo": RECALIBRACION,
  "tienda-que-crece": RECALIBRACION,
  "oficina-y-whatsapp": RECALIBRACION,
  // Con la vara arreglada (`b39ea6dd`): con la vieja salía 0/3 sobre una
  // página buena.
  "pedido-minimo": RECALIBRACION,
};
