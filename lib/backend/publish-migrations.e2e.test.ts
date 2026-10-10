// @vitest-environment node
//
// Publicar las migraciones del borrador (spec local 2026-10-09, sección 6)
// contra un Postgres DE VERDAD: el ensayo detecta lo que destruye datos reales y
// no deja nada; aplicar deja la migración y la copia de lo que se borra. Sólo
// con PAGES_E2E_DATABASE_URL.
import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { newScope, type ScopeCreds } from "./environments";
import { newDatabasePassword, newProjectRef } from "./keys";
import { withAdmin } from "./pg";
import { dropDeveloperRole, dropProjectDatabase, provisionDatabase } from "./provision";
import { applyPending, pendingMigrations, rehearse } from "./publish-migrations";
import { applyMigrationAs, readRecordedMigrations, type RecordedMigration } from "./recorded-migrations";

const E2E_URL = process.env.PAGES_E2E_DATABASE_URL;

describe.skipIf(!E2E_URL)("publicar las migraciones del borrador", () => {
  const ref = newProjectRef();
  const password = newDatabasePassword();
  const live: ScopeCreds = { scope: newScope(ref, "live"), ref, password };
  const draft: ScopeCreds = { scope: newScope(ref, "draft"), ref, password };
  const BASE: RecordedMigration = {
    version: "20261009000000",
    name: "ventas",
    statements: ["create table public.ventas (id bigint generated always as identity primary key, total numeric not null, descuento numeric, cantidad text)"],
  };

  beforeAll(() => {
    process.env.PAGES_DATABASE_URL = E2E_URL;
    process.env.PAGES_AUTHENTICATOR_PASSWORD = randomBytes(18).toString("base64url");
  });

  beforeEach(async () => {
    for (const s of [live, draft]) {
      await dropProjectDatabase(s.scope);
      await provisionDatabase({ scope: s.scope, ref, dbPassword: password });
      await applyMigrationAs(s, BASE);
    }
    await withAdmin(`ol_${live.scope}`, (r) => r.exec(`insert into public.ventas (total, descuento, cantidad) values (100, 5, '2'), (200, null, '3'), (300, 10, '1')`));
  }, 120_000);

  afterAll(async () => {
    if (!E2E_URL) return;
    await dropProjectDatabase(draft.scope);
    await dropProjectDatabase(live.scope);
    await dropDeveloperRole(ref);
  }, 60_000);

  const push = async (m: RecordedMigration) => {
    expect(await applyMigrationAs(draft, m)).toEqual({ ok: true });
    const p = await pendingMigrations(draft.scope, live.scope);
    if (!p.ok) throw new Error("divergió");
    return p.pending;
  };
  const columns = async () =>
    (await withAdmin(`ol_${live.scope}`, (r) => r.query(`select column_name from information_schema.columns where table_name = 'ventas' order by 1`))).rows.map(
      (r) => r.column_name,
    );

  it("lo pendiente es lo del borrador que producción no tiene, con sus sentencias", async () => {
    const pending = await push({ version: "20261009000001", name: "notas", statements: ["alter table public.ventas add column notas text"] });
    expect(pending.map((m) => m.version)).toEqual(["20261009000001"]);
  });

  it("añadir una columna no es destructivo, y el ensayo no deja nada", async () => {
    const pending = await push({ version: "20261009000001", name: "notas", statements: ["alter table public.ventas add column notas text"] });
    const r = await rehearse(live, pending);
    expect(r.ok && r.destructive).toEqual([]);
    expect(await columns()).not.toContain("notas");
  });

  it("borrar una columna con datos se cuenta (2 valores, el null no)", async () => {
    const pending = await push({ version: "20261009000001", name: "sin_descuento", statements: ["alter table public.ventas drop column descuento"] });
    const r = await rehearse(live, pending);
    expect(r.ok && r.destructive).toEqual([{ kind: "drop_column", table: "ventas", column: "descuento", count: 2 }]);
    expect(await columns()).toContain("descuento");
  });

  it("cambiar de tipo se cuenta", async () => {
    const pending = await push({
      version: "20261009000001",
      name: "cantidad_int",
      statements: ["alter table public.ventas alter column cantidad type integer using cantidad::integer"],
    });
    const r = await rehearse(live, pending);
    expect(r.ok && r.destructive).toEqual([{ kind: "alter_type", table: "ventas", column: "cantidad", from: "text", to: "integer", count: 3 }]);
  });

  it("delete y truncate cuentan sus filas", async () => {
    const pending = await push({
      version: "20261009000001",
      name: "limpiar",
      statements: ["delete from public.ventas where total > 150", "truncate public.ventas"],
    });
    const r = await rehearse(live, pending);
    expect(r.ok && r.destructive.map((d) => d.count)).toEqual([2, 1]);
  });

  it("una sentencia que falla en producción se dice, y no queda nada", async () => {
    await withAdmin(`ol_${live.scope}`, (r) => r.exec(`insert into public.ventas (total, cantidad) values (1, 'mucho')`));
    const pending = await push({
      version: "20261009000001",
      name: "cantidad_int",
      statements: ["alter table public.ventas alter column cantidad type integer using cantidad::integer"],
    });
    const r = await rehearse(live, pending);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.migration).toBe("20261009000001_cantidad_int");
  });

  it("aplicar deja la migración en producción, con copia de lo que se borra", async () => {
    const pending = await push({ version: "20261009000001", name: "sin_descuento", statements: ["alter table public.ventas drop column descuento"] });
    expect(await applyPending(live, pending, { backupTables: ["ventas"] })).toEqual({ ok: true });
    expect(await columns()).not.toContain("descuento");
    expect((await readRecordedMigrations(live.scope)).map((m) => m.version)).toEqual(["20261009000000", "20261009000001"]);
    const backups = await withAdmin(`ol_${live.scope}`, (r) =>
      r.query(`select table_name from information_schema.tables where table_schema = 'openlen_backups'`),
    );
    expect(backups.rows).toHaveLength(1);
  });

  it("producción con una migración que el borrador no tiene: divergencia", async () => {
    await applyMigrationAs(live, { version: "20261009000009", name: "a_mano", statements: ["select 1"] });
    expect(await pendingMigrations(draft.scope, live.scope)).toEqual({ ok: false, diverged: ["20261009000009"] });
  });
});
