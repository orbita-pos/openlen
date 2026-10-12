// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";

import { pgDeploymentStore } from "./deployments-pg";

const DUENO = "prueba-fndep-dueno";
const PROYECTO = "prueba-fndep-proyecto";

beforeAll(async () => {
  await exigirBaseLocal();
  await db.insert(schema.users).values({ id: DUENO, email: `${DUENO}@ejemplo.invalido`, name: DUENO }).onConflictDoNothing();
  await db.delete(schema.projects).where(eq(schema.projects.id, PROYECTO));
  await db.insert(schema.projects).values({ id: PROYECTO, userId: DUENO, title: "dep", brief: "", data: { html: "<p>x</p>" } });
});
afterAll(async () => {
  await db.delete(schema.projects).where(eq(schema.projects.id, PROYECTO));
  await db.delete(schema.users).where(eq(schema.users.id, DUENO));
});

describe("pgDeploymentStore", () => {
  it("guarda, sustituye, devuelve los mapas aparte y borra", async () => {
    const rec = { projectId: PROYECTO, environment: "draft" as const, catalog: "2026-11", hash: "h1", functions: [{ name: "a", verifyJwt: true }], deployedAt: new Date() };
    await pgDeploymentStore.put(rec, { "index.mjs": '{"version":3}' });
    expect(await pgDeploymentStore.get(PROYECTO, "draft")).toMatchObject({ hash: "h1", functions: [{ name: "a", verifyJwt: true }] });
    await pgDeploymentStore.put({ ...rec, hash: "h2" }, {});
    expect((await pgDeploymentStore.get(PROYECTO, "draft"))!.hash).toBe("h2");
    expect(await pgDeploymentStore.maps(PROYECTO, "draft")).toEqual({});
    await pgDeploymentStore.put({ ...rec, hash: "h3" }, { "index.mjs": '{"version":3}' });
    expect(await pgDeploymentStore.maps(PROYECTO, "draft")).toEqual({ "index.mjs": '{"version":3}' });
    expect(await pgDeploymentStore.get(PROYECTO, "live")).toBeNull();
    await pgDeploymentStore.delete(PROYECTO, "draft");
    expect(await pgDeploymentStore.get(PROYECTO, "draft")).toBeNull();
  });
});
