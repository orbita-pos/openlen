// @vitest-environment node
//
// `supabase db query` contra un Postgres DE VERDAD (spec local 2026-10-09,
// sección 8): --linked lee producción y NO puede escribir; --local escribe datos
// de prueba pero no cambia tablas. Sólo con PAGES_E2E_DATABASE_URL.
import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newScope, type ScopeCreds } from "./environments";
import { newDatabasePassword, newProjectRef } from "./keys";
import { withAdmin } from "./pg";
import { dropDeveloperRole, dropProjectDatabase, provisionDatabase } from "./provision";
import { provisionReadOnlyRole } from "./read-only";
import { applyMigrationAs } from "./recorded-migrations";
import { runDraftQuery, runLiveQuery } from "./sql-query";

const E2E_URL = process.env.PAGES_E2E_DATABASE_URL;

describe.skipIf(!E2E_URL)("db query contra Postgres de verdad", () => {
  const ref = newProjectRef();
  const password = newDatabasePassword();
  const roPassword = newDatabasePassword();
  const live: ScopeCreds = { scope: newScope(ref, "live"), ref, password };
  const draft: ScopeCreds = { scope: newScope(ref, "draft"), ref, password };
  const MIG = {
    version: "20261009000000",
    name: "ventas",
    statements: [
      "create table public.ventas (id bigint generated always as identity primary key, total numeric not null)",
      "alter table public.ventas enable row level security",
    ],
  };

  beforeAll(async () => {
    process.env.PAGES_DATABASE_URL = E2E_URL;
    process.env.PAGES_AUTHENTICATOR_PASSWORD = randomBytes(18).toString("base64url");
    for (const s of [live, draft]) {
      await provisionDatabase({ scope: s.scope, ref, dbPassword: password });
      await applyMigrationAs(s, MIG);
    }
    await withAdmin(`ol_${live.scope}`, (r) => r.exec(`insert into public.ventas (total) values (100), (250)`));
    await provisionReadOnlyRole({ scope: live.scope, ref, password: roPassword });
  }, 120_000);

  afterAll(async () => {
    if (!E2E_URL) return;
    await dropProjectDatabase(draft.scope);
    await dropProjectDatabase(live.scope);
    await dropDeveloperRole(ref);
  }, 60_000);

  const liveCount = async () => Number((await withAdmin(`ol_${live.scope}`, (r) => r.query(`select count(*) as n from public.ventas`))).rows[0]?.n);

  it("--linked lee producción saltando RLS (como el dueño)", async () => {
    const r = await runLiveQuery({ scope: live.scope, roPassword }, "select sum(total)::int as total from public.ventas");
    expect(r).toEqual({ kind: "rows", columns: ["total"], rows: [[350]], truncated: false });
  });

  it("--linked no escribe", async () => {
    const r = await runLiveQuery({ scope: live.scope, roPassword }, "delete from public.ventas");
    expect(r.kind).toBe("error");
    expect(await liveCount()).toBe(2);
  });

  it("--linked no escribe ni pidiendo lectura-escritura", async () => {
    expect((await runLiveQuery({ scope: live.scope, roPassword }, "set transaction read write")).kind).toBe("error");
    expect(await liveCount()).toBe(2);
  });

  it("--linked no deja escapar de la transacción con varias sentencias", async () => {
    const r = await runLiveQuery({ scope: live.scope, roPassword }, "commit; delete from public.ventas");
    expect(r.kind).toBe("error");
    expect(await liveCount()).toBe(2);
  });

  it("--linked corta en 500 filas", async () => {
    const r = await runLiveQuery({ scope: live.scope, roPassword }, "select g from generate_series(1, 600) g");
    expect(r.kind === "rows" && r.rows.length).toBe(500);
    expect(r.kind === "rows" && r.truncated).toBe(true);
  });

  it("--local escribe datos de prueba", async () => {
    expect(await runDraftQuery(draft, "insert into public.ventas (total) values (1)")).toEqual({ kind: "command", tag: "INSERT" });
  });

  it("--local NO cambia tablas: eso va en una migración", async () => {
    const r = await runDraftQuery(draft, "create table public.atajo (id int)");
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toMatch(/supabase migration new/);
    const exists = await withAdmin(`ol_${draft.scope}`, (q) => q.query(`select to_regclass('public.atajo') is not null as ok`));
    expect(exists.rows[0]?.ok).toBe(false);
  });
});
