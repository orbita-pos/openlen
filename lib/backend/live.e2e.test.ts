// @vitest-environment node
//
// Producción nace al publicar (spec local 2026-10-09, 6.3), contra un Postgres
// DE VERDAD: vacía, o como copia exacta del borrador. Sólo con
// PAGES_E2E_DATABASE_URL.
import { randomBytes } from "node:crypto";

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { newScope, type ScopeCreds } from "./environments";
import { newDatabasePassword, newProjectRef } from "./keys";
import { createLiveDatabase, dropLiveDatabase } from "./live";
import { withAdmin } from "./pg";
import { dropDeveloperRole, dropProjectDatabase, provisionDatabase } from "./provision";
import { applyMigrationAs, readRecordedMigrations, runStatementsAs } from "./recorded-migrations";
import { ensureStorageProvisioned } from "./storage/provision";

const E2E_URL = process.env.PAGES_E2E_DATABASE_URL;

describe.skipIf(!E2E_URL)("producción nace al publicar", () => {
  const ref = newProjectRef();
  const password = newDatabasePassword();
  const live: ScopeCreds = { scope: newScope(ref, "live"), ref, password };
  const draft: ScopeCreds = { scope: newScope(ref, "draft"), ref, password };

  beforeAll(() => {
    process.env.PAGES_DATABASE_URL = E2E_URL;
    process.env.PAGES_AUTHENTICATOR_PASSWORD = randomBytes(18).toString("base64url");
  });

  beforeEach(async () => {
    await provisionDatabase({ scope: draft.scope, ref, dbPassword: password });
    await ensureStorageProvisioned({ scope: draft.scope, ref });
    await applyMigrationAs(draft, {
      version: "20261009000000",
      name: "productos",
      statements: ["create table public.productos (id bigint generated always as identity primary key, nombre text not null)"],
    });
    await runStatementsAs(draft, ["insert into public.productos (nombre) values ('Coca'), ('Pan')"]);
  }, 120_000);

  afterEach(async () => {
    await dropLiveDatabase(live.scope, null);
    await dropProjectDatabase(draft.scope);
    await dropDeveloperRole(ref);
  }, 60_000);

  it("vacía: la base existe y no tiene ni tablas ni migraciones (las pone publicar)", async () => {
    await createLiveDatabase({ live, draft, copyData: false, store: null });
    expect(await readRecordedMigrations(live.scope)).toEqual([]);
  });

  it("copia: las tablas, los datos y la historia de migraciones, y el rol puede seguir migrando", async () => {
    await createLiveDatabase({ live, draft, copyData: true, store: null });
    const names = await withAdmin(`ol_${live.scope}`, (r) => r.query(`select nombre from public.productos order by 1`));
    expect(names.rows.map((r) => r.nombre)).toEqual(["Coca", "Pan"]);
    expect((await readRecordedMigrations(live.scope)).map((m) => m.version)).toEqual(["20261009000000"]);
    expect(await applyMigrationAs(live, { version: "20261009000001", name: "x", statements: ["alter table public.productos add column precio numeric"] })).toEqual({ ok: true });
  });

  it("la copia no se lleva las sesiones de prueba", async () => {
    await createLiveDatabase({ live, draft, copyData: true, store: null });
    const s = await withAdmin(`ol_${live.scope}`, (r) => r.query(`select count(*)::int as n from auth.sessions`));
    expect(s.rows[0]?.n).toBe(0);
  });
});
