// @vitest-environment node
//
// LOS CONTADORES EN POSTGRES (lib/functions/usage-pg.ts), contra la base LOCAL
// con `npm run functions:migrate` aplicada.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";

import { pgUsageStore } from "./usage-pg";

const DUENO = "prueba-fnusage-dueno";
const PROYECTO = "prueba-fnusage-proyecto";
const MES = "1999-01";

beforeAll(async () => {
  await exigirBaseLocal();
  await db.insert(schema.users).values({ id: DUENO, email: `${DUENO}@ejemplo.invalido`, name: DUENO }).onConflictDoNothing();
  await db.delete(schema.projects).where(eq(schema.projects.id, PROYECTO));
  await db.insert(schema.projects).values({ id: PROYECTO, userId: DUENO, title: "uso", brief: "", data: { html: "<p>x</p>" } });
  await db.delete(schema.functionPools).where(eq(schema.functionPools.month, MES));
});
afterAll(async () => {
  await db.delete(schema.functionPools).where(eq(schema.functionPools.month, MES));
  await db.delete(schema.projects).where(eq(schema.projects.id, PROYECTO));
  await db.delete(schema.users).where(eq(schema.users.id, DUENO));
});

describe("pgUsageStore", () => {
  it("la cuota: entra hasta el tope y se devuelve", async () => {
    expect(await pgUsageStore.consumeCall(PROYECTO, MES, 2)).toBe(true);
    expect(await pgUsageStore.consumeCall(PROYECTO, MES, 2)).toBe(true);
    expect(await pgUsageStore.consumeCall(PROYECTO, MES, 2)).toBe(false);
    await pgUsageStore.refundCall(PROYECTO, MES);
    expect(await pgUsageStore.consumeCall(PROYECTO, MES, 2)).toBe(true);
  });

  it("🔴 diez reservas A LA VEZ con hueco para tres: entran exactamente tres", async () => {
    const r = await Promise.all(Array.from({ length: 10 }, () => pgUsageStore.reserve("free", MES, 100, 300)));
    expect(r.filter(Boolean)).toHaveLength(3);
  });

  it("liquidar suelta la reserva y apunta lo gastado en la bolsa y en el proyecto", async () => {
    await pgUsageStore.settle({ pool: "free", month: MES, reservedNanoUsd: 100, actualNanoUsd: 40, projectId: PROYECTO });
    const [p] = await db.select().from(schema.functionPools).where(and(eq(schema.functionPools.month, MES), eq(schema.functionPools.pool, "free")));
    expect(p).toMatchObject({ reservedNanoUsd: 200, spentNanoUsd: 40 });
    const [u] = await db.select().from(schema.functionUsage).where(and(eq(schema.functionUsage.projectId, PROYECTO), eq(schema.functionUsage.month, MES)));
    expect(u!.nanoUsd).toBe(40);
  });
});
