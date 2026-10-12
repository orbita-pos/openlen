// lib/functions/meter.ts — LO QUE CUESTA UNA LLAMADA, en NANOdólares (spec local
// 2026-10-12, Parte 6). Precio de lista de Cloudflare Workers for Platforms:
// $0,30 por millón de llamadas y $0,02 por millón de ms de CPU, SIN restar lo
// que incluyen los $25 del mes: así la factura real nunca pasa del tope.
// Cloudflare no da la CPU real de cada llamada: se cuenta TODA la permitida.

export const NANO_USD_PER_REQUEST = 300;
export const NANO_USD_PER_CPU_MS = 20;

/** La CPU de NUESTRO despachador en cada llamada (lee el evento y pasa el flujo):
 *  también se cobra. Holgada; el ensayo real la mide (infra/FUNCTIONS_RUNBOOK.md §6). */
export const DISPATCHER_CPU_MS = 5;

/** Lo que cuesta una llamada con esa CPU, a precio de lista. */
export function callCostNanoUsd(cpuMs: number): number {
  return NANO_USD_PER_REQUEST + NANO_USD_PER_CPU_MS * Math.max(0, cpuMs);
}

/** Lo que se reserva y se liquida: toda la CPU que su plan le deja a la función
 *  y la del despachador. */
export function worstCallNanoUsd(cpuMs: number): number {
  return callCostNanoUsd(cpuMs + DISPATCHER_CPU_MS);
}

/** Una llamada que no llegó a la función (el despachador no contestó o no la
 *  encontró por fallo nuestro): como mucho, el despachador. */
export function unreachedCallNanoUsd(): number {
  return callCostNanoUsd(DISPATCHER_CPU_MS);
}

/** `AAAA-MM` en UTC. */
export function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}

/** Los topes de cada bolsa, en nanodólares. */
export interface PoolCaps {
  readonly free: number;
  readonly paid: number;
}

function dolares(v: string | undefined, porDefecto: number): number {
  if (v === undefined || v.trim() === "") return porDefecto;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : porDefecto;
}

export function capsFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): PoolCaps {
  return {
    free: Math.round(dolares(env.OPENLEN_FUNCTIONS_CAP_FREE_USD, 1) * 1e9),
    paid: Math.round(dolares(env.OPENLEN_FUNCTIONS_CAP_PAID_USD, 25) * 1e9),
  };
}
