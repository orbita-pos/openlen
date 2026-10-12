// lib/functions/usage.ts — DÓNDE SE CUENTA (spec local 2026-10-11, Parte 3): las
// llamadas del mes de cada proyecto y el dinero de cada bolsa (reservado y
// gastado). Cada operación es atómica en su almacén: el de Postgres
// (usage-pg.ts) en producción; éste, en memoria, para las pruebas.

import type { Pool } from "./limits";

export interface UsageStore {
  /** +1 llamada si no llega a la cuota: devuelve cuántas lleva el mes CON ésta,
   *  o `null` si la cuota está agotada. Atómico: dos a la vez ven números distintos. */
  consumeCall(projectId: string, month: string, quota: number): Promise<number | null>;
  refundCall(projectId: string, month: string): Promise<void>;
  /** Reserva `nanoUsd` si cabe bajo el tope (gastado + reservado + esto ≤ tope). */
  reserve(pool: Pool, month: string, nanoUsd: number, capNanoUsd: number): Promise<boolean>;
  /** Suelta la reserva y apunta lo gastado (en la bolsa y en el proyecto).
   *  Devuelve lo gastado de la bolsa en el mes, con esto. */
  settle(o: { pool: Pool; month: string; reservedNanoUsd: number; actualNanoUsd: number; projectId: string }): Promise<{ readonly poolSpentNanoUsd: number }>;
  /** El aviso de la bolsa: `true` para UNA llamada al mes y bolsa, cuando lo
   *  gastado ya llega a `thresholdNanoUsd`. */
  claimPoolAlert(pool: Pool, month: string, thresholdNanoUsd: number): Promise<boolean>;
  /** El aviso de cuota: `true` para UNA llamada por nivel (80, 100) al mes y
   *  proyecto; dado el del 100 %, el del 80 % ya no sale. */
  claimQuotaAlert(projectId: string, month: string, percent: 80 | 100): Promise<boolean>;
}

export function memoryUsageStore(): UsageStore & {
  readonly calls: Map<string, number>;
  readonly pools: Map<string, { reserved: number; spent: number }>;
  readonly projectNanoUsd: Map<string, number>;
} {
  const calls = new Map<string, number>();
  const pools = new Map<string, { reserved: number; spent: number }>();
  const projectNanoUsd = new Map<string, number>();
  const avisadas = new Set<string>();
  const avisosDeCuota = new Map<string, number>();
  const bolsa = (pool: Pool, month: string) => {
    const k = `${month}|${pool}`;
    if (!pools.has(k)) pools.set(k, { reserved: 0, spent: 0 });
    return pools.get(k)!;
  };
  return {
    calls,
    pools,
    projectNanoUsd,
    async consumeCall(projectId, month, quota) {
      const k = `${projectId}|${month}`;
      const n = calls.get(k) ?? 0;
      if (n >= quota) return null;
      calls.set(k, n + 1);
      return n + 1;
    },
    async refundCall(projectId, month) {
      const k = `${projectId}|${month}`;
      calls.set(k, Math.max(0, (calls.get(k) ?? 0) - 1));
    },
    async reserve(pool, month, nanoUsd, cap) {
      const b = bolsa(pool, month);
      if (b.spent + b.reserved + nanoUsd > cap) return false;
      b.reserved += nanoUsd;
      return true;
    },
    async settle({ pool, month, reservedNanoUsd, actualNanoUsd, projectId }) {
      const b = bolsa(pool, month);
      b.reserved = Math.max(0, b.reserved - reservedNanoUsd);
      b.spent += actualNanoUsd;
      const k = `${projectId}|${month}`;
      projectNanoUsd.set(k, (projectNanoUsd.get(k) ?? 0) + actualNanoUsd);
      return { poolSpentNanoUsd: b.spent };
    },
    async claimPoolAlert(pool, month, threshold) {
      const k = `${month}|${pool}`;
      if (avisadas.has(k) || bolsa(pool, month).spent < threshold) return false;
      avisadas.add(k);
      return true;
    },
    async claimQuotaAlert(projectId, month, percent) {
      const k = `${projectId}|${month}`;
      if ((avisosDeCuota.get(k) ?? 0) >= percent) return false;
      avisosDeCuota.set(k, percent);
      return true;
    },
  };
}
