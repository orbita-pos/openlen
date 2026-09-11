// lib/agent/esfuerzo.ts — LA POSTURA del Agente: lo que el usuario elige.
//
// 🔴 TRES CAPAS, Y ÉSTA ES LA DE ARRIBA. `FireworksReasoningEffort` hacía los
// tres trabajos a la vez —vocabulario, política y cable— y por eso el mando
// anterior se rompía: `none` no es un nivel bajo, es APAGAR la función, y vive
// en otra capa. El binario de Claude Code las tiene separadas y por eso su
// selector funciona.
//
// Las etiquetas describen el RESULTADO, no los tokens. Es literal del binario:
// «Quick, straightforward implementation», «Balanced approach with standard
// testing». Ninguna dice cuánto piensa.
export type EsfuerzoAgente = "auto" | "low" | "medium" | "high" | "xhigh";

export const ESFUERZOS: readonly EsfuerzoAgente[] = [
  "auto",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

/** Lo que se le enseña al usuario. Resultado, nunca tokens. */
export const ETIQUETA: Readonly<Record<EsfuerzoAgente, string>> = {
  auto: "Automático — lo que el modelo traiga",
  low: "Rápido y directo",
  medium: "Equilibrado",
  high: "A fondo",
  xhigh: "Máxima capacidad",
};

// ⚠️ PROVISIONALES, Y NO ES UN TODO OLVIDADO. Salen de la escala nativa 1-100
// de v4.1 Flash, medida n=1 por punto (1→14, 25→38, 50→50, 100→113 tokens de
// razonamiento). Calibrarlos de verdad exige un arnés que corra cada caso N
// veces y juzgue por TASA: el 2026-09-11 se midió que la batería tiene ±2 casos
// de ruido, así que hoy no se puede. Entregarlos como si estuvieran medidos
// sería repetir el error que este módulo arregla — un número heredado que nadie
// revisó. Por eso el defecto es `auto`, que no usa ninguno.
const PRESUPUESTO: Readonly<Record<Exclude<EsfuerzoAgente, "auto">, number>> = {
  low: 10,
  medium: 30,
  high: 60,
  xhigh: 100,
};

/**
 * El número que viaja al cable, o `undefined` para `auto`.
 *
 * `auto` devuelve `undefined` A PROPÓSITO: el campo NO se manda, que es lo que
 * el binario llama «use the default effort level for your model». Mandar la
 * cadena "auto" haría que el proveedor cayera a su defecto por ACCIDENTE en vez
 * de por diseño, y no habría forma de distinguirlo de un error.
 *
 * El recorte es del binario: `budget_tokens: Math.min(G, k - 1)`. Pedir más
 * pensamiento del que cabe en la salida es pedir un turno truncado.
 */
export function presupuestoDeEsfuerzo(
  nivel: EsfuerzoAgente,
  techoSalida: number,
): number | undefined {
  if (nivel === "auto") return undefined;
  return Math.min(PRESUPUESTO[nivel], techoSalida - 1);
}
