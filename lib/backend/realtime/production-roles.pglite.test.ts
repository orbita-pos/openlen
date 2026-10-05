// @vitest-environment node
//
// REALTIME CON LOS ROLES DE PRODUCCIÓN, EN PGLITE (pieza 15, carril D). Como
// storage/production-roles.pglite.test.ts: el administrador del clúster NO es
// superusuario (CREATEDB CREATEROLE BYPASSRLS, createrole_self_grant), y monta
// el esquema `realtime` de verdad con `provisionDatabase` +
// `ensureRealtimeProvisioned` (`withAdmin` va a esta PGlite). Cada uno entra con
// su rol de SESIÓN (`set session authorization`).
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { describe, expect, it, vi } from "vitest";

import type { SqlRunner } from "../db";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const REF = "qrstuvwxyzabcdefghij";
const DEV = `ol_${REF}`;
const ADMIN = "openlen_pages_admin";

const db = vi.hoisted(() => ({ pg: null as unknown as PGlite }));

async function as(role: string): Promise<void> {
  await db.pg.exec(`set session authorization ${role}`);
  if (role === ADMIN) await db.pg.exec(`set createrole_self_grant = 'set, inherit'`);
}

const runner: SqlRunner = {
  exec: async (sql) => {
    await db.pg.exec(sql);
  },
  query: async (sql, params) => ({ rows: (await db.pg.query(sql, params as unknown[] | undefined)).rows as Record<string, unknown>[] }),
};

vi.mock("../pg", () => ({
  withAdmin: async (_dbName: string, fn: (r: SqlRunner) => Promise<unknown>) => {
    await as(ADMIN);
    return fn(runner);
  },
  closePools: async () => {},
}));

const { provisionDatabase } = await import("../provision");
const { ensureRealtimeProvisioned, forgetRealtimeProvisioned } = await import("./provision");

/** Un clúster nuevo con el administrador de setup-pages-cluster.sh y la base
 *  del proyecto creada. `rootGrants`: lo que root le concede además. */
async function cluster(rootGrants: string): Promise<void> {
  db.pg = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
  await db.pg.exec(`
    create role ${ADMIN} login createdb createrole bypassrls nosuperuser;
    alter database postgres owner to ${ADMIN};
    ${rootGrants}
  `);
  process.env.PAGES_AUTHENTICATOR_PASSWORD = "clave-de-prueba";
  await provisionDatabase({ ref: REF, dbPassword: "clave-del-desarrollador" });
  await as(ADMIN);
  await db.pg.exec(`grant connect, create on database postgres to ${DEV}`);
  forgetRealtimeProvisioned();
}

describe("Realtime con los roles de producción (sin superusuario)", () => {
  it("el administrador limitado monta el esquema, y el desarrollador publica su tabla con SU sesión", async () => {
    await cluster(`grant set on parameter log_min_messages to ${ADMIN};`);
    await ensureRealtimeProvisioned(REF);
    forgetRealtimeProvisioned();
    await ensureRealtimeProvisioned(REF); // otro «proceso»: no rompe
    await as("postgres");
    const m = await db.pg.query<{ n: number }>(`select count(*)::int as n from realtime.schema_migrations`);
    expect(m.rows[0]!.n).toBe(88);
    const s = await db.pg.query<{ rolsuper: boolean }>(`select rolsuper from pg_roles where rolname = $1`, [ADMIN]);
    expect(s.rows[0]!.rolsuper).toBe(false);

    await as(DEV);
    await db.pg.exec(`
      create table public.mensajes (id bigint generated always as identity primary key, texto text);
      alter publication supabase_realtime add table public.mensajes;
    `);
    const pub = await db.pg.query(`select tablename from pg_publication_tables where pubname = 'supabase_realtime'`);
    expect(pub.rows).toEqual([{ tablename: "mensajes" }]);
    await expect(db.pg.exec(`set role supabase_realtime_admin`)).rejects.toThrow(/permission denied to set role/);
    await db.pg.close();
  });

  // Su función `list_changes` lleva `SET log_min_messages TO 'fatal'`, un
  // parámetro de superusuario: Supabase le da `SET ON PARAMETER` a su rol. Aquí
  // sólo root puede dárselo al administrador (setup-pages-cluster.sh).
  it("BRAZO DE CONTROL: sin el SET ON PARAMETER log_min_messages de root, el administrador no puede crear list_changes", async () => {
    await cluster("");
    await expect(ensureRealtimeProvisioned(REF)).rejects.toThrow(/permission denied to set parameter "log_min_messages"/);
    await as("postgres");
    const r = await db.pg.query<{ ok: boolean }>(`select to_regclass('realtime.subscription') is not null as ok`);
    expect(r.rows[0]!.ok).toBe(false);
    await db.pg.close();
  });
});
