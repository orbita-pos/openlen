// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";

import { recentFunctionErrors, recentInvocations, recordInvocation } from "./invocations-pg";

const DUENO = "prueba-fninv-dueno";
const PROYECTO = "prueba-fninv-proyecto";

beforeAll(async () => {
  await exigirBaseLocal();
  await db.insert(schema.users).values({ id: DUENO, email: `${DUENO}@ejemplo.invalido`, name: DUENO }).onConflictDoNothing();
  await db.delete(schema.projects).where(eq(schema.projects.id, PROYECTO));
  await db.insert(schema.projects).values({ id: PROYECTO, userId: DUENO, title: "inv", brief: "", data: { html: "<p>x</p>" } });
});
afterAll(async () => {
  await db.delete(schema.projects).where(eq(schema.projects.id, PROYECTO));
  await db.delete(schema.users).where(eq(schema.users.id, DUENO));
});

beforeEach(async () => {
  // Freeze only Date: PostgreSQL and its network timers still run normally.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-11T10:01:00Z"));
  await db.delete(schema.functionInvocations).where(eq(schema.functionInvocations.projectId, PROYECTO));
});

afterEach(() => vi.useRealTimers());

describe("las llamadas guardadas", () => {
  it("se guardan y se leen las de desde una fecha, en orden, de SU entorno", async () => {
    const base = { projectId: PROYECTO, name: "checkout", status: 200, errorCode: null, ms: 12, logs: [{ level: "log", msg: "hola" }], error: null };
    await recordInvocation({ ...base, environment: "draft", startedAt: new Date("2026-10-11T10:00:00Z") });
    await recordInvocation({ ...base, environment: "draft", status: 500, errorCode: "WORKER_ERROR", error: "Error: x", startedAt: new Date("2026-10-11T10:00:05Z") });
    await recordInvocation({ ...base, environment: "live", startedAt: new Date("2026-10-11T10:00:06Z") });
    const r = await recentInvocations(PROYECTO, "draft", new Date("2026-10-11T10:00:01Z"));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ status: 500, errorCode: "WORKER_ERROR", error: "Error: x", logs: [{ level: "log", msg: "hola" }] });
    expect(await recentInvocations(PROYECTO, "draft", new Date("2026-10-11T09:00:00Z"))).toHaveLength(2);
  });

  it("los últimos errores, de los dos entornos, los más nuevos primero; lo que fue bien no", async () => {
    const hace = (s: number) => new Date(Date.now() - s * 1000);
    const base = { projectId: PROYECTO, name: "webhook", ms: 5, logs: [], error: null, errorCode: null, status: 200 };
    await recordInvocation({ ...base, environment: "draft", status: 500, errorCode: "WORKER_ERROR", startedAt: hace(55) });
    await recordInvocation({ ...base, environment: "live", startedAt: hace(30) });
    await recordInvocation({ ...base, environment: "live", status: 500, errorCode: "WORKER_ERROR", error: "Error: a", startedAt: hace(20) });
    await recordInvocation({ ...base, environment: "draft", status: 504, errorCode: "IDLE_TIMEOUT", startedAt: hace(10) });
    const r = await recentFunctionErrors(PROYECTO);
    expect(r.map((x) => [x.environment, x.errorCode])).toEqual([
      ["draft", "IDLE_TIMEOUT"],
      ["live", "WORKER_ERROR"],
      ["draft", "WORKER_ERROR"],
    ]);
  });

  it("poda solo lo anterior a siete días y conserva el límite exacto", async () => {
    vi.setSystemTime(new Date("2026-10-11T12:00:00Z"));
    const base = { projectId: PROYECTO, environment: "draft" as const, name: "retention", status: 500, errorCode: "WORKER_ERROR", ms: 1, logs: [], error: null };
    await db.insert(schema.functionInvocations).values([
      { ...base, id: `${PROYECTO}-expired`, startedAt: new Date("2026-10-04T11:59:59.999Z") },
      { ...base, id: `${PROYECTO}-boundary`, startedAt: new Date("2026-10-04T12:00:00Z") },
    ]);
    await recordInvocation({ ...base, startedAt: new Date("2026-10-11T11:59:30Z") });

    const rows = await recentInvocations(PROYECTO, "draft", new Date("2026-10-01T00:00:00Z"));
    expect(rows.map((row) => row.startedAt.toISOString())).toEqual([
      "2026-10-04T12:00:00.000Z",
      "2026-10-11T11:59:30.000Z",
    ]);
    expect(await recentFunctionErrors(PROYECTO)).toHaveLength(2);
  });
});
