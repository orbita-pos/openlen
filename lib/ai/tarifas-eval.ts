/**
 * LAS TARIFAS CON LAS QUE UNA CORRIDA PAGADA SE FRENA A SÍ MISMA.
 *
 * Vivían dentro de `scripts/agent-eval.ts`. Se sacan aquí el 2026-09-04 porque
 * un segundo runner (`scripts/sobre-ab.ts`) las necesita, y la alternativa era
 * copiarlas — que es exactamente el defecto que ya mordió a este fichero:
 * estuvieron CABLEADAS y desfasadas (0.14/0.28 contra 0.22/0.66) y sin entrada
 * para Pro, así que el Agente se cobraba como si fuera Gemini y el tope de
 * gasto mentía. Una tarifa duplicada es una tarifa que se queda vieja en un
 * sitio y no en el otro.
 *
 * 🔴 SALEN DE `lib/credits.ts`, que es donde se cobra de verdad. Aquí no se
 * escribe ningún número a mano salvo el de visión, que no pasa por ahí.
 */
import { creditRate } from "@/lib/credits";

export interface TarifaPorMillon {
  readonly input: number;
  readonly cached: number;
  readonly output: number;
}

const RATES_PER_M = {
  "gemini-2.5-flash": { input: 0.3, cached: 0.075, output: 2.5 },
  "accounts/fireworks/models/deepseek-v4-flash-0731": {
    ...creditRate("deepseek-flash"),
    cached: creditRate("deepseek-flash").cached ?? 0,
  },
  "accounts/fireworks/models/deepseek-v4-pro-0813": {
    ...creditRate("deepseek-pro"),
    cached: creditRate("deepseek-pro").cached ?? 0,
  },
} as const;

/** La tarifa de los ojos, que siguen siendo Gemini pase lo que pase. */
export const VISION_RATE: TarifaPorMillon = RATES_PER_M["gemini-2.5-flash"];

/** Un modelo desconocido se cobra al MÁS CARO que conocemos: equivocarse hacia
 *  arriba detiene la batería antes de tiempo; hacia abajo, vacía la cuenta. */
export function rateFor(modelId: string): TarifaPorMillon {
  return RATES_PER_M[modelId as keyof typeof RATES_PER_M] ?? RATES_PER_M["gemini-2.5-flash"];
}

/** Lo que cuesta un turno, en dólares, a partir de sus tokens medidos. */
export function usdDeTurno(
  tokens: { entrada: number; cacheada: number; salida: number },
  tarifa: TarifaPorMillon,
): number {
  return (
    ((tokens.entrada - tokens.cacheada) * tarifa.input +
      tokens.cacheada * tarifa.cached +
      tokens.salida * tarifa.output) / 1e6
  );
}

/**
 * Lo que costaron VARIOS turnos. Existe como función y no como un `reduce` en
 * cada runner por un motivo medido: el 2026-09-04 un `reduce` de
 * `scripts/sobre-ab.ts` perdió su acumulador y durante una corrida entera
 * imprimió el coste del ÚLTIMO turno como si fuera el total — $0,0091 en vez de
 * $0,3415, o sea 37x MENOS. Y ése es el lado peligroso: un total que se queda
 * corto no detiene una corrida, la deja seguir.
 *
 * La suma de una lista de precios no es lógica que cada llamador deba reescribir.
 */
export function usdTotal(
  turnos: readonly { entrada: number; cacheada: number; salida: number }[],
  tarifa: TarifaPorMillon,
): number {
  let usd = 0;
  for (const t of turnos) usd += usdDeTurno(t, tarifa);
  return usd;
}
