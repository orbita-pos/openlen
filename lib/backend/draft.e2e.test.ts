// @vitest-environment node
//
// La vida del borrador (spec local 2026-10-09, sección 7) contra un Postgres
// DE VERDAD. Sólo con PAGES_E2E_DATABASE_URL (ver pg-e2e.test.ts).
import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildDraftDatabase, resetDraftDatabase } from "./draft";
import { newScope, type ScopeCreds } from "./environments";
import { newDatabasePassword, newProjectRef } from "./keys";
import { withAdmin } from "./pg";
import { dropDeveloperRole, dropProjectDatabase, provisionDatabase } from "./provision";
import { applyMigrationAs, readRecordedMigrations } from "./recorded-migrations";
import { ensureStorageProvisioned } from "./storage/provision";

const E2E_URL = process.env.PAGES_E2E_DATABASE_URL;

describe.skipIf(!E2E_URL)("la vida del borrador", () => {
  const ref = newProjectRef();
  const password = newDatabasePassword();
  const live: ScopeCreds = { scope: newScope(ref, "live"), ref, password };
  const draft: ScopeCreds = { scope: newScope(ref, "draft"), ref, password };
  const files = {
    "/supabase/migrations/20261009000001_descuento.sql": "alter table public.productos add column descuento numeric;",
    "/supabase/seed.sql": "insert into public.productos (nombre) values ('Coca de prueba'), ('Pan de prueba');",
  };

  beforeAll(async () => {
    process.env.PAGES_DATABASE_URL = E2E_URL;
    process.env.PAGES_AUTHENTICATOR_PASSWORD = randomBytes(18).toString("base64url");
    await provisionDatabase({ scope: live.scope, ref, dbPassword: password });
    await ensureStorageProvisioned({ scope: live.scope, ref });
    await applyMigrationAs(live, {
      version: "20261009000000",
      name: "productos",
      statements: ["create table public.productos (id bigint generated always as identity primary key, nombre text not null)"],
    });
    await withAdmin(`ol_${live.scope}`, (r) => r.exec(`insert into public.productos (nombre) values ('Producto REAL')`));
    await provisionDatabase({ scope: draft.scope, ref, dbPassword: password });
    await ensureStorageProvisioned({ scope: draft.scope, ref });
  }, 120_000);

  afterAll(async () => {
    if (!E2E_URL) return;
    await dropProjectDatabase(draft.scope);
    await dropProjectDatabase(live.scope);
    await dropDeveloperRole(ref);
  }, 60_000);

  const names = async (scope: string) =>
    (await withAdmin(`ol_${scope}`, (r) => r.query(`select nombre from public.productos order by nombre`))).rows.map((r) => r.nombre);

  it("nace con las tablas de producción y el seed, sin los datos reales", async () => {
    const r = await buildDraftDatabase({ draft, live, files, includeLocal: false });
    expect(r).toEqual({ ok: true, applied: ["20261009000000"], seeded: true });
    expect(await names(draft.scope)).toEqual(["Coca de prueba", "Pan de prueba"]);
    expect((await readRecordedMigrations(draft.scope)).map((m) => m.version)).toEqual(["20261009000000"]);
  });

  it("db reset la rehace: producción + las migraciones locales pendientes + seed", async () => {
    await withAdmin(`ol_${draft.scope}`, (r) => r.exec(`insert into public.productos (nombre) values ('basura')`));
    const r = await resetDraftDatabase({ draft, live, files, includeLocal: true });
    expect(r).toEqual({ ok: true, applied: ["20261009000000", "20261009000001"], seeded: true });
    expect(await names(draft.scope)).toEqual(["Coca de prueba", "Pan de prueba"]);
    const cols = await withAdmin(`ol_${draft.scope}`, (q) =>
      q.query(`select 1 from information_schema.columns where table_name = 'productos' and column_name = 'descuento'`),
    );
    expect(cols.rows).toHaveLength(1);
    expect(await names(live.scope)).toEqual(["Producto REAL"]);
  });

  it("un seed roto se dice, con su sentencia", async () => {
    const r = await resetDraftDatabase({ draft, live, files: { "/supabase/seed.sql": "insert into no_existe values (1);" }, includeLocal: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.step).toBe("seed");
  });
});
