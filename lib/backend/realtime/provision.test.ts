// @vitest-environment node
//
// El esquema `realtime` en una base que YA existe: perezoso, una vez por
// proceso, con el cerrojo dentro de la base del proyecto (como storage).
import { describe, expect, it, vi } from "vitest";

import type { SqlRunner } from "../db";
import { newStorageTestProject } from "../storage/testing";
import { TEST_REF } from "../testing/project";
import { ensureRealtimeProvisioned, forgetRealtimeProvisioned, type AdminRunner } from "./provision";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

async function base() {
  const t = await newStorageTestProject("");
  const runner: SqlRunner = {
    exec: async (sql) => {
      await t.pg.exec(sql);
    },
    query: async (sql, params) => ({ rows: (await t.pg.query(sql, params as unknown[] | undefined)).rows as Record<string, unknown>[] }),
  };
  const calls: string[] = [];
  const admin: AdminRunner = async (dbName, fn) => {
    calls.push(dbName);
    return fn(runner);
  };
  const tiene = async () => (await t.pg.query<{ ok: boolean }>(`select to_regclass('realtime.subscription') is not null as ok`)).rows[0]!.ok;
  return { t, admin, calls, tiene };
}

describe("ensureRealtimeProvisioned", () => {
  it("monta el esquema realtime en una base que no lo tenía, con sus roles del clúster", async () => {
    forgetRealtimeProvisioned();
    const b = await base();
    expect(await b.tiene()).toBe(false);
    await ensureRealtimeProvisioned(TEST_REF, b.admin);
    expect(await b.tiene()).toBe(true);
    expect(b.calls).toEqual(["postgres", `ol_${TEST_REF}`]);
    const roles = await b.t.pg.query(`select 1 from pg_roles where rolname = 'supabase_realtime_admin'`);
    expect(roles.rows).toHaveLength(1);
  });

  it("la segunda vez en el mismo proceso no toca la base", async () => {
    forgetRealtimeProvisioned();
    const b = await base();
    await ensureRealtimeProvisioned(TEST_REF, b.admin);
    await ensureRealtimeProvisioned(TEST_REF, b.admin);
    expect(b.calls).toHaveLength(2);
  });

  it("si algo falla a mitad, no queda un esquema a medias y lo vuelve a intentar", async () => {
    forgetRealtimeProvisioned();
    const b = await base();
    let rota = true;
    const admin: AdminRunner = async (dbName, fn) =>
      b.admin(dbName, async (r) =>
        fn({
          exec: async (sql) => {
            if (rota && sql.includes("create publication supabase_realtime")) throw new Error("se cayó la conexión");
            return r.exec(sql);
          },
          query: r.query,
        }),
      );
    await expect(ensureRealtimeProvisioned(TEST_REF, admin)).rejects.toThrow("se cayó la conexión");
    expect(await b.tiene()).toBe(false);
    rota = false;
    await ensureRealtimeProvisioned(TEST_REF, admin);
    expect(await b.tiene()).toBe(true);
  });

  // El sondeo de postgres_changes lee el slot con `openlen_realtime` (LOGIN
  // REPLICATION, lo crea root): sin CONNECT a la base del proyecto no entra
  // (provisionDatabase se lo quita a PUBLIC). Donde el rol no existe, nada.
  it("da CONNECT a openlen_realtime si el clúster lo tiene", async () => {
    forgetRealtimeProvisioned();
    const b = await base();
    await b.t.pg.exec(`create role openlen_realtime login replication; revoke connect on database postgres from public;`);
    await ensureRealtimeProvisioned(TEST_REF, b.admin);
    const r = await b.t.pg.query<{ ok: boolean }>(`select has_database_privilege('openlen_realtime', current_database(), 'CONNECT') as ok`);
    expect(r.rows[0]!.ok).toBe(true);
  });
});
