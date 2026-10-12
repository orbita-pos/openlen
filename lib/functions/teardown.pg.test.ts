// @vitest-environment node
//
// Borrar un proyecto se lleva sus secretos, lo desplegado, su uso y sus llamadas
// (spec local 2026-10-11, Parte 2): en cascada con la fila. Base de usar y tirar.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";

import { pgDeploymentStore } from "./deployments-pg";
import { recordInvocation } from "./invocations-pg";
import { pgSecretStore } from "./secret-store-pg";

process.env.NEXTAUTH_SECRET ??= "secreto-de-prueba-del-borrado";

const DUENO = "prueba-fntear-dueno";
const PROYECTO = "prueba-fntear-proyecto";

beforeAll(async () => {
  await exigirBaseLocal();
  await db.insert(schema.users).values({ id: DUENO, email: `${DUENO}@ejemplo.invalido`, name: DUENO }).onConflictDoNothing();
  await db.delete(schema.projects).where(eq(schema.projects.id, PROYECTO));
  await db.insert(schema.projects).values({ id: PROYECTO, userId: DUENO, title: "tear", brief: "", data: { html: "<p>x</p>" } });
});
afterAll(async () => {
  await db.delete(schema.projects).where(eq(schema.projects.id, PROYECTO));
  await db.delete(schema.users).where(eq(schema.users.id, DUENO));
});

describe("borrar el proyecto", () => {
  it("🔴 se lleva sus secretos, lo desplegado (y su paquete), su uso y sus llamadas", async () => {
    await pgSecretStore.set(PROYECTO, "live", { STRIPE_SECRET_KEY: "sk_live_x" }, DUENO);
    await pgDeploymentStore.put({ projectId: PROYECTO, environment: "live", catalog: "2026-11", hash: "h", functions: [{ name: "a", verifyJwt: true }], deployedAt: new Date() }, {}, { "index.mjs": "x" });
    await db.insert(schema.functionUsage).values({ projectId: PROYECTO, month: "2026-10", calls: 3, nanoUsd: 600 });
    await recordInvocation({ projectId: PROYECTO, environment: "live", name: "a", status: 200, errorCode: null, ms: 5, logs: [], error: null, startedAt: new Date() });
    await db.delete(schema.projects).where(eq(schema.projects.id, PROYECTO));
    for (const T of [schema.functionSecrets, schema.functionDeployments, schema.functionUsage, schema.functionInvocations]) {
      expect(await db.select().from(T).where(eq(T.projectId, PROYECTO))).toEqual([]);
    }
  });
});
