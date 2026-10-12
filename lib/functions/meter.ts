// lib/functions/meter.ts — LO QUE CUESTA UNA LLAMADA, en NANOdólares (spec local
// 2026-10-11, Parte 3). Precio de lista de AWS Lambda arm64 en us-east-1 ($0,20
// por millón de peticiones; $0,0000133334 por GB‑s, redondeado hacia arriba),
// SIN restar la capa gratis: así la factura real nunca pasa del tope. La fase 3
// los vuelve a comprobar en https://aws.amazon.com/lambda/pricing/.

import { FUNCTION_MEMORY_MB } from "./limits";

export const NANO_USD_PER_REQUEST = 200;
export const NANO_USD_PER_GB_SECOND = 13_334;

export function costNanoUsd(ms: number, memoryMb = FUNCTION_MEMORY_MB): number {
  return NANO_USD_PER_REQUEST + Math.ceil((Math.max(0, ms) / 1000) * (memoryMb / 1024) * NANO_USD_PER_GB_SECOND);
}

/** Lo más que puede costar una llamada: su tiempo límite entero. */
export function worstCaseNanoUsd(timeoutSec: number, memoryMb = FUNCTION_MEMORY_MB): number {
  return costNanoUsd(timeoutSec * 1000, memoryMb);
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
    free: Math.round(dolares(env.OPENLEN_FUNCTIONS_CAP_FREE_USD, 0.25) * 1e9),
    paid: Math.round(dolares(env.OPENLEN_FUNCTIONS_CAP_PAID_USD, 0.75) * 1e9),
  };
}
