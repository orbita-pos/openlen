// @vitest-environment node
//
// Los secretos en Postgres (spec local 2026-10-11, Parte 4). Corre en la base de
// usar y tirar: DATABASE_URL=postgres://postgres@127.0.0.1:5562/openlen.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";

import { pgSecretStore } from "./secret-store-pg";
import { secretDigest } from "./secrets";

process.env.NEXTAUTH_SECRET ??= "secreto-de-prueba-de-los-secretos";

const DUENO = "prueba-fnsec-dueno";
const PROYECTO = "prueba-fnsec-proyecto";
const OTRO = "prueba-fnsec-otro";
const VALOR = "sk_test_valor_de_prueba_123456";

beforeAll(async () => {
  await exigirBaseLocal();
  await db.insert(schema.users).values({ id: DUENO, email: `${DUENO}@ejemplo.invalido`, name: DUENO }).onConflictDoNothing();
  for (const id of [PROYECTO, OTRO]) {
    await db.delete(schema.projects).where(eq(schema.projects.id, id));
    await db.insert(schema.projects).values({ id, userId: DUENO, title: "sec", brief: "", data: { html: "<p>x</p>" } });
  }
});
afterAll(async () => {
  for (const id of [PROYECTO, OTRO]) await db.delete(schema.projects).where(eq(schema.projects.id, id));
  await db.delete(schema.users).where(eq(schema.users.id, DUENO));
});

describe("pgSecretStore", () => {
  it("🔴 el valor va cifrado; lo que se lista no lo lleva; la huella es la de Supabase", async () => {
    await pgSecretStore.set(PROYECTO, "draft", { STRIPE_SECRET_KEY: VALOR }, DUENO);
    const [crudo] = await db.select().from(schema.functionSecrets).where(eq(schema.functionSecrets.projectId, PROYECTO));
    expect(crudo!.valueEncrypted).not.toContain(VALOR);
    expect(crudo!.digest).toBe(secretDigest(VALOR));
    const lista = await pgSecretStore.list(PROYECTO);
    expect(lista).toEqual([{ environment: "draft", name: "STRIPE_SECRET_KEY", digest: secretDigest(VALOR), updatedAt: expect.any(Date), updatedBy: DUENO }]);
    expect(JSON.stringify(lista)).not.toContain(VALOR);
    expect(await pgSecretStore.values(PROYECTO, "draft")).toEqual({ STRIPE_SECRET_KEY: VALOR });
    expect(await pgSecretStore.values(PROYECTO, "live")).toEqual({});
  });

  it("sustituir y quitar, por entorno", async () => {
    await pgSecretStore.set(PROYECTO, "live", { STRIPE_SECRET_KEY: "sk_live_1", B: "b" }, null);
    await pgSecretStore.set(PROYECTO, "live", { STRIPE_SECRET_KEY: "sk_live_2" }, null);
    expect(await pgSecretStore.values(PROYECTO, "live")).toEqual({ STRIPE_SECRET_KEY: "sk_live_2", B: "b" });
    expect(await pgSecretStore.unset(PROYECTO, "live", ["B", "NO"])).toEqual(["B"]);
    expect((await pgSecretStore.list(PROYECTO)).map((r) => `${r.environment}:${r.name}`)).toEqual(["draft:STRIPE_SECRET_KEY", "live:STRIPE_SECRET_KEY"]);
  });

  it("🔴 borrar el proyecto se lleva sus secretos", async () => {
    await pgSecretStore.set(OTRO, "draft", { K: "v" }, null);
    await db.delete(schema.projects).where(eq(schema.projects.id, OTRO));
    expect(await db.select().from(schema.functionSecrets).where(eq(schema.functionSecrets.projectId, OTRO))).toEqual([]);
  });
});
