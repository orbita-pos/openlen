// @vitest-environment node
//
// LAS VARIABLES DEL AJUSTE CONTRA POSTGRES (lib/apps/env/store.ts). Base LOCAL
// (`exigirBaseLocal`) con `npm run env-vars:migrate` aplicada.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";
import { envVersionOf } from "./hash";
import type { EnvVarInput } from "./rules";
import { envVarNames, envVarsFor, listEnvVars, replaceEnvVars } from "./store";

const DUENO = "prueba-env-dueno";
const EDITORA = "prueba-env-editora";
const PROYECTO = "prueba-env-proyecto";

beforeAll(async () => {
  await exigirBaseLocal();
  for (const id of [DUENO, EDITORA]) {
    await db.insert(schema.users).values({ id, email: `${id}@ejemplo.invalido`, name: id }).onConflictDoNothing();
  }
});
beforeEach(async () => {
  await db.delete(schema.projects).where(eq(schema.projects.id, PROYECTO));
  await db.insert(schema.projects).values({ id: PROYECTO, userId: DUENO, title: "env", brief: "", data: { html: "<div id=root></div>" } });
});
afterAll(async () => {
  await db.delete(schema.projects).where(eq(schema.projects.id, PROYECTO));
  for (const id of [DUENO, EDITORA]) await db.delete(schema.users).where(eq(schema.users.id, id));
});

const guardar = async (vars: EnvVarInput[], version?: string, userId = DUENO) =>
  replaceEnvVars({ projectId: PROYECTO, ownerId: DUENO, userId, version: version ?? envVersionOf(await listEnvVars(PROYECTO)), vars });
const huella = async () =>
  (await db.select({ h: schema.projects.envHash }).from(schema.projects).where(eq(schema.projects.id, PROYECTO)))[0]?.h ?? null;

describe("replaceEnvVars", () => {
  it("guarda la lista entera y cada entorno lee lo suyo", async () => {
    const r = await guardar([
      { name: "VITE_STRIPE", target: "draft", value: "pk_test_1" },
      { name: "VITE_STRIPE", target: "production", value: "pk_live_1" },
      { name: "VITE_MAPS", target: "production", value: "AIza1" },
    ]);
    expect(r.ok).toBe(true);
    expect(await envVarsFor(PROYECTO, "draft")).toEqual({ VITE_STRIPE: "pk_test_1" });
    expect(await envVarsFor(PROYECTO, "production")).toEqual({ VITE_STRIPE: "pk_live_1", VITE_MAPS: "AIza1" });
    expect(await envVarNames(PROYECTO)).toEqual({ VITE_MAPS: ["production"], VITE_STRIPE: ["draft", "production"] });
  });

  it("🔴 la huella sólo se mueve con PRODUCCIÓN, y sin variables es nula", async () => {
    await guardar([{ name: "VITE_A", target: "production", value: "1" }]);
    const h1 = await huella();
    expect(h1).toMatch(/^[0-9a-f]{16}$/);
    await guardar([{ name: "VITE_A", target: "production", value: "1" }, { name: "VITE_B", target: "draft", value: "x" }]);
    expect(await huella()).toBe(h1);
    await guardar([{ name: "VITE_A", target: "production", value: "2" }]);
    expect(await huella()).not.toBe(h1);
    await guardar([]);
    expect(await huella()).toBeNull();
  });

  it("🔴 con una versión vieja, 409 y no se pisa nada", async () => {
    await guardar([{ name: "VITE_A", target: "draft", value: "1" }]);
    const r = await guardar([{ name: "VITE_B", target: "draft", value: "2" }], envVersionOf([]));
    expect(r).toMatchObject({ ok: false, reason: "conflict" });
    expect(await envVarsFor(PROYECTO, "draft")).toEqual({ VITE_A: "1" });
  });

  it("lo inválido no entra, y un secreto nuevo pide el aviso leído", async () => {
    expect(await guardar([{ name: "stripe", target: "draft", value: "1" }])).toMatchObject({ ok: false, reason: "invalid" });
    expect(await guardar([{ name: "VITE_S", target: "draft", value: "sk_live_51H8abcdefghijklmnop" }])).toMatchObject({ ok: false, reason: "invalid" });
    expect(await guardar([{ name: "VITE_S", target: "draft", value: "sk_live_51H8abcdefghijklmnop", acknowledgedPublic: true }])).toMatchObject({ ok: true });
    // Ya guardado: volver a mandarlo (al añadir otra) no pide el aviso otra vez.
    expect(
      await guardar([
        { name: "VITE_S", target: "draft", value: "sk_live_51H8abcdefghijklmnop" },
        { name: "VITE_T", target: "draft", value: "1" },
      ]),
    ).toMatchObject({ ok: true });
  });

  it("lo que no cambió conserva su autor; lo nuevo lleva el de quien guarda", async () => {
    await guardar([{ name: "VITE_A", target: "draft", value: "1" }]);
    await guardar([{ name: "VITE_A", target: "draft", value: "1" }, { name: "VITE_B", target: "draft", value: "2" }], undefined, EDITORA);
    const filas = await listEnvVars(PROYECTO);
    expect(filas.find((f) => f.name === "VITE_A")?.updatedBy).toBe(DUENO);
    expect(filas.find((f) => f.name === "VITE_B")?.updatedBy).toBe(EDITORA);
  });

  it("un proyecto de otro dueño no se toca", async () => {
    expect(await replaceEnvVars({ projectId: PROYECTO, ownerId: EDITORA, userId: EDITORA, version: envVersionOf([]), vars: [] })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("borrar el proyecto borra sus variables", async () => {
    await guardar([{ name: "VITE_A", target: "draft", value: "1" }]);
    await db.delete(schema.projects).where(eq(schema.projects.id, PROYECTO));
    expect(await listEnvVars(PROYECTO)).toEqual([]);
  });
});
