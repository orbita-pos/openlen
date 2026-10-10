// @vitest-environment node
//
// Dos entornos de un mismo proyecto en un Postgres DE VERDAD: dos bases, un
// solo rol de desarrollador. Sólo con PAGES_E2E_DATABASE_URL (ver pg-e2e.test.ts).
import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newScope, type ScopeCreds } from "./environments";
import { newDatabasePassword, newProjectRef } from "./keys";
import { withAdmin } from "./pg";
import { dropDeveloperRole, dropProjectDatabase, provisionDatabase } from "./provision";
import { applyMigrationAs, readRecordedMigrations } from "./recorded-migrations";

const E2E_URL = process.env.PAGES_E2E_DATABASE_URL;

describe.skipIf(!E2E_URL)("dos entornos de un mismo proyecto", () => {
  const ref = newProjectRef();
  const password = newDatabasePassword();
  const live: ScopeCreds = { scope: ref, ref, password };
  const draft: ScopeCreds = { scope: newScope(ref, "draft"), ref, password };

  beforeAll(async () => {
    process.env.PAGES_DATABASE_URL = E2E_URL;
    process.env.PAGES_AUTHENTICATOR_PASSWORD = randomBytes(18).toString("base64url");
    await provisionDatabase({ scope: live.scope, ref, dbPassword: password });
    await provisionDatabase({ scope: draft.scope, ref, dbPassword: password });
  }, 120_000);

  afterAll(async () => {
    if (!E2E_URL) return;
    await dropProjectDatabase(draft.scope);
    await dropProjectDatabase(live.scope);
    await dropDeveloperRole(ref);
  }, 60_000);

  const tableExists = async (scope: string, table: string) =>
    (await withAdmin(`ol_${scope}`, (r) => r.query(`select to_regclass($1) is not null as ok`, [table]))).rows[0]?.ok === true;

  it("una migración en el borrador no llega a producción", async () => {
    const r = await applyMigrationAs(draft, {
      version: "20261009000000",
      name: "productos",
      statements: ["create table public.productos (id bigint primary key, nombre text)"],
    });
    expect(r).toEqual({ ok: true });
    expect((await readRecordedMigrations(draft.scope)).map((m) => m.version)).toEqual(["20261009000000"]);
    expect((await readRecordedMigrations(draft.scope))[0]?.statements).toEqual([
      "create table public.productos (id bigint primary key, nombre text)",
    ]);
    expect(await readRecordedMigrations(live.scope)).toEqual([]);
    expect(await tableExists(draft.scope, "public.productos")).toBe(true);
    expect(await tableExists(live.scope, "public.productos")).toBe(false);
  });

  it("una sentencia que falla no deja nada, ni la fila de la migración", async () => {
    const r = await applyMigrationAs(draft, {
      version: "20261009000001",
      name: "rota",
      statements: ["create table public.a (id int)", "select * from no_existe"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failedAt).toBe(1);
    expect(await tableExists(draft.scope, "public.a")).toBe(false);
    expect((await readRecordedMigrations(draft.scope)).map((m) => m.version)).toEqual(["20261009000000"]);
  });
});
