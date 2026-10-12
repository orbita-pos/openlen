// lib/functions/usage.ts — DÓNDE SE CUENTA (spec local 2026-10-11, Parte 3): las
// llamadas del mes de cada proyecto y el dinero de cada bolsa (reservado y
// gastado). Cada operación es atómica en su almacén: el de Postgres
// (usage-pg.ts) en producción; éste, en memoria, para las pruebas.

import type { Pool } from "./limits";

export interface UsageStore {
  /** +1 llamada si no llega a la cuota. `false` = cuota agotada. */
  consumeCall(projectId: string, month: string, quota: number): Promise<boolean>;
  refundCall(projectId: string, month: string): Promise<void>;
  /** Reserva `nanoUsd` si cabe bajo el tope (gastado + reservado + esto ≤ tope). */
  reserve(pool: Pool, month: string, nanoUsd: number, capNanoUsd: number): Promise<boolean>;
  /** Suelta la reserva y apunta lo gastado (en la bolsa y en el proyecto). */
  settle(o: { pool: Pool; month: string; reservedNanoUsd: number; actualNanoUsd: number; projectId: string }): Promise<void>;
}

export function memoryUsageStore(): UsageStore & {
  readonly calls: Map<string, number>;
  readonly pools: Map<string, { reserved: number; spent: number }>;
  readonly projectNanoUsd: Map<string, number>;
} {
  const calls = new Map<string, number>();
  const pools = new Map<string, { reserved: number; spent: number }>();
  const projectNanoUsd = new Map<string, number>();
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
      if (n >= quota) return false;
      calls.set(k, n + 1);
      return true;
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
    },
  };
}
