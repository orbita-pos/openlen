// @vitest-environment node
//
// El esquema `storage` en una base que YA existe (las de antes de Storage no
// vuelven a pasar por provisionDatabase): perezoso, una vez por proceso, con
// el cerrojo dentro de la base del proyecto.
import { describe, expect, it, vi } from "vitest";

import type { SqlRunner } from "../db";
import { newTestProject, TEST_REF } from "../testing/project";
import { ensureStorageProvisioned, forgetStorageProvisioned, type AdminRunner } from "./provision";

// Montar el esquema real (GoTrue + las 73 de storage) en PGlite tarda; en paralelo, más que los 5 s de serie.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

async function base() {
  const t = await newTestProject("");
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
  const tiene = async () => (await t.pg.query<{ ok: boolean }>(`select to_regclass('storage.objects') is not null as ok`)).rows[0]!.ok;
  return { t, admin, calls, tiene };
}

describe("ensureStorageProvisioned", () => {
  it("monta el esquema storage en una base que no lo tenía, con los roles del clúster", async () => {
    forgetStorageProvisioned();
    const b = await base();
    expect(await b.tiene()).toBe(false);
    await ensureStorageProvisioned({ scope: TEST_REF, ref: TEST_REF }, b.admin);
    expect(await b.tiene()).toBe(true);
    expect(b.calls).toEqual(["postgres", `ol_${TEST_REF}`]);
    const roles = await b.t.pg.query(`select 1 from pg_roles where rolname = 'supabase_storage_admin'`);
    expect(roles.rows).toHaveLength(1);
  });

  it("la segunda vez en el mismo proceso no toca la base", async () => {
    forgetStorageProvisioned();
    const b = await base();
    await ensureStorageProvisioned({ scope: TEST_REF, ref: TEST_REF }, b.admin);
    await ensureStorageProvisioned({ scope: TEST_REF, ref: TEST_REF }, b.admin);
    expect(b.calls).toHaveLength(2);
  });

  it("si algo falla a mitad, no queda un esquema a medias y lo vuelve a intentar", async () => {
    forgetStorageProvisioned();
    const b = await base();
    let rota = true;
    const admin: AdminRunner = async (dbName, fn) =>
      b.admin(dbName, async (r) =>
        fn({
          exec: async (sql) => {
            if (rota && sql.includes("cada uno") === false && sql.includes("create schema if not exists storage")) {
              await r.exec(sql);
              throw new Error("se cayó la conexión");
            }
            return r.exec(sql);
          },
          query: r.query,
        }),
      );
    await expect(ensureStorageProvisioned({ scope: TEST_REF, ref: TEST_REF }, admin)).rejects.toThrow("se cayó la conexión");
    expect(await b.tiene()).toBe(false);
    const esquema = await b.t.pg.query(`select 1 from pg_namespace where nspname = 'storage'`);
    expect(esquema.rows).toHaveLength(0);
    rota = false;
    await ensureStorageProvisioned({ scope: TEST_REF, ref: TEST_REF }, admin);
    expect(await b.tiene()).toBe(true);
  });

  it("un ref que no es un ref: no se pega en SQL", async () => {
    forgetStorageProvisioned();
    const b = await base();
    await expect(ensureStorageProvisioned({ scope: "x; drop table y", ref: TEST_REF }, b.admin)).rejects.toThrow();
    expect(b.calls).toEqual([]);
  });
});
