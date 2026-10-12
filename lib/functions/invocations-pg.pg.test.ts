// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";

import { recentInvocations, recordInvocation } from "./invocations-pg";

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
});
