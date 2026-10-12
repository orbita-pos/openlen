// lib/functions/meter.ts — LO QUE CUESTA UNA LLAMADA, en NANOdólares (spec local
// 2026-10-12, Parte 6). Precio de lista de Cloudflare Workers for Platforms:
// $0,30 por millón de llamadas y $0,02 por millón de ms de CPU, SIN restar lo
// que incluyen los $25 del mes: así la factura real nunca pasa del tope.
// Cloudflare no da la CPU real de cada llamada: se cuenta TODA la permitida.

export const NANO_USD_PER_REQUEST = 300;
export const NANO_USD_PER_CPU_MS = 20;

/** Lo que cuenta una llamada: la petición y toda la CPU que su plan le deja. */
export function callCostNanoUsd(cpuMs: number): number {
  return NANO_USD_PER_REQUEST + NANO_USD_PER_CPU_MS * Math.max(0, cpuMs);
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
