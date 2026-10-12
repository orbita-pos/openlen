// @vitest-environment node
//
// LOS CONTADORES EN POSTGRES (lib/functions/usage-pg.ts), contra la base LOCAL
// con `npm run functions:migrate` aplicada.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";

import { monthCalls, pgUsageStore } from "./usage-pg";

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
  it("la cuota: entra hasta el tope —cada una dice cuántas lleva— y se devuelve", async () => {
    expect(await pgUsageStore.consumeCall(PROYECTO, MES, 2)).toBe(1);
    expect(await pgUsageStore.consumeCall(PROYECTO, MES, 2)).toBe(2);
    expect(await pgUsageStore.consumeCall(PROYECTO, MES, 2)).toBeNull();
    await pgUsageStore.refundCall(PROYECTO, MES);
    expect(await pgUsageStore.consumeCall(PROYECTO, MES, 2)).toBe(2);
  });

  it("🔴 diez reservas A LA VEZ con hueco para tres: entran exactamente tres", async () => {
    const r = await Promise.all(Array.from({ length: 10 }, () => pgUsageStore.reserve("free", MES, 100, 300)));
    expect(r.filter(Boolean)).toHaveLength(3);
  });

  it("liquidar suelta la reserva y apunta lo gastado en la bolsa y en el proyecto", async () => {
    expect(await pgUsageStore.settle({ pool: "free", month: MES, reservedNanoUsd: 100, actualNanoUsd: 40, projectId: PROYECTO })).toEqual({ poolSpentNanoUsd: 40 });
    const [p] = await db.select().from(schema.functionPools).where(and(eq(schema.functionPools.month, MES), eq(schema.functionPools.pool, "free")));
    expect(p).toMatchObject({ reservedNanoUsd: 200, spentNanoUsd: 40 });
    const [u] = await db.select().from(schema.functionUsage).where(and(eq(schema.functionUsage.projectId, PROYECTO), eq(schema.functionUsage.month, MES)));
    expect(u!.nanoUsd).toBe(40);
  });

  it("🔴 diez a la vez: cada una ve SU número (el que cruza un umbral es uno solo)", async () => {
    const r = await Promise.all(Array.from({ length: 10 }, () => pgUsageStore.consumeCall(PROYECTO, "1999-02", 100)));
    expect([...r].map(Number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("las llamadas del mes de un proyecto (0 si no hay fila)", async () => {
    expect(await monthCalls(PROYECTO, "1999-02")).toBe(10);
    expect(await monthCalls(PROYECTO, "1998-12")).toBe(0);
  });

  it("el aviso de la bolsa: sólo pasado el umbral y sólo UNA vez al mes", async () => {
    expect(await pgUsageStore.claimPoolAlert("free", MES, 1_000_000)).toBe(false); // lo gastado es 40
    expect(await pgUsageStore.claimPoolAlert("free", MES, 40)).toBe(true);
    expect(await pgUsageStore.claimPoolAlert("free", MES, 40)).toBe(false);
  });
});
