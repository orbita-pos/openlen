// lib/functions/usage-pg.ts — LOS CONTADORES EN LA BASE DE LA APP (spec local
// 2026-10-11, Parte 3). Cada operación es UNA sentencia: la condición del tope
// va en el WHERE del UPDATE, así que dos llamadas a la vez no pasan las dos.

import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";

import type { UsageStore } from "./usage";

/** `db.execute` devuelve un resultado de node-postgres (con `.rows`) o un array. */
function filas(r: unknown): unknown[] {
  return Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? []);
}

export const pgUsageStore: UsageStore = {
  async consumeCall(projectId, month, quota) {
    // La primera del mes inserta 1 (la cuota es siempre ≥ 1).
    const r = await db.execute(sql`
      INSERT INTO "functionUsage" ("projectId", "month", "calls") VALUES (${projectId}, ${month}, 1)
      ON CONFLICT ("projectId", "month") DO UPDATE SET "calls" = "functionUsage"."calls" + 1
      WHERE "functionUsage"."calls" < ${quota}
      RETURNING "calls"`);
    const [f] = filas(r) as { calls: number | string }[];
    return f ? Number(f.calls) : null;
  },
  async refundCall(projectId, month) {
    await db.execute(sql`
      UPDATE "functionUsage" SET "calls" = GREATEST("calls" - 1, 0)
      WHERE "projectId" = ${projectId} AND "month" = ${month}`);
  },
  async reserve(pool, month, nanoUsd, cap) {
    await db.execute(sql`INSERT INTO "functionPools" ("month", "pool") VALUES (${month}, ${pool}) ON CONFLICT DO NOTHING`);
    const r = await db.execute(sql`
      UPDATE "functionPools" SET "reservedNanoUsd" = "reservedNanoUsd" + ${nanoUsd}
      WHERE "month" = ${month} AND "pool" = ${pool} AND "spentNanoUsd" + "reservedNanoUsd" + ${nanoUsd} <= ${cap}
      RETURNING 1`);
    return filas(r).length > 0;
  },
  async settle({ pool, month, reservedNanoUsd, actualNanoUsd, projectId }) {
    const r = await db.execute(sql`
      UPDATE "functionPools"
         SET "reservedNanoUsd" = GREATEST("reservedNanoUsd" - ${reservedNanoUsd}, 0),
             "spentNanoUsd" = "spentNanoUsd" + ${actualNanoUsd}
       WHERE "month" = ${month} AND "pool" = ${pool}
       RETURNING "spentNanoUsd"`);
    await db.execute(sql`
      UPDATE "functionUsage" SET "nanoUsd" = "nanoUsd" + ${actualNanoUsd}
      WHERE "projectId" = ${projectId} AND "month" = ${month}`);
    const [f] = filas(r) as { spentNanoUsd: number | string }[];
    return { poolSpentNanoUsd: f ? Number(f.spentNanoUsd) : 0 };
  },
  async claimPoolAlert(pool, month, threshold) {
    // El aviso es UNA fila que se marca: dos a la vez, sólo una la marca.
    const r = await db.execute(sql`
      UPDATE "functionPools" SET "alertedAt" = now()
      WHERE "month" = ${month} AND "pool" = ${pool} AND "alertedAt" IS NULL AND "spentNanoUsd" >= ${threshold}
      RETURNING 1`);
    return filas(r).length > 0;
  },
};
