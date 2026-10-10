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

import type { ProjectDatabase, SqlRunner } from "../db";
import { pgliteProjectDatabase } from "../testing/pglite";
import { createSubscriptions, parseSubscriptionParams } from "./subscriptions";
import { installWalCapture, queueChangeSource } from "./testing";

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
  await provisionDatabase({ scope: REF, ref: REF, dbPassword: "clave-del-desarrollador" });
  await as(ADMIN);
  await db.pg.exec(`grant connect, create on database postgres to ${DEV}`);
  forgetRealtimeProvisioned();
}

describe("Realtime con los roles de producción (sin superusuario)", () => {
  it("el administrador limitado monta el esquema, y el desarrollador publica su tabla con SU sesión", async () => {
    await cluster(`grant set on parameter log_min_messages to ${ADMIN};`);
    await ensureRealtimeProvisioned({ scope: REF, ref: REF });
    forgetRealtimeProvisioned();
    await ensureRealtimeProvisioned({ scope: REF, ref: REF }); // otro «proceso»: no rompe
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

  // 🔴 La mitad SIN privilegios de `list_changes` partida (poller.ts): la
  // publicación, el alta de suscripciones y `apply_rls`, por una sesión de
  // `authenticator` como en producción —no el superusuario de PGlite—. RLS
  // decide quién ve cada fila.
  it("las suscripciones y apply_rls por authenticator: cada uno ve lo suyo", async () => {
    await cluster(`grant set on parameter log_min_messages to ${ADMIN};`);
    await ensureRealtimeProvisioned({ scope: REF, ref: REF });
    await as(DEV);
    await db.pg.exec(`
      create table public.mensajes (id bigint generated always as identity primary key, user_id uuid not null, texto text);
      alter table public.mensajes enable row level security;
      create policy "lo suyo" on public.mensajes for select to authenticated using ((select auth.uid()) = user_id);
      alter publication supabase_realtime add table public.mensajes;
    `);
    await as("postgres");
    await installWalCapture(db.pg, ["public.mensajes"]);

    const authenticatorDb: ProjectDatabase = {
      transaction: async (fn) => {
        await as("authenticator");
        try {
          return await pgliteProjectDatabase(db.pg).transaction(fn);
        } finally {
          await as("postgres");
        }
      },
    };
    const U1 = "11111111-1111-4111-8111-111111111111";
    const U2 = "22222222-2222-4222-8222-222222222222";
    const parsed = parseSubscriptionParams({ event: "INSERT", schema: "public", table: "mensajes" });
    if (!parsed.ok) throw new Error(parsed.error);
    await createSubscriptions(authenticatorDb, [
      { id: "aaaaaaaa-0000-4000-8000-000000000001", claims: { role: "authenticated", sub: U1 }, params: parsed.params },
      { id: "aaaaaaaa-0000-4000-8000-000000000002", claims: { role: "authenticated", sub: U2 }, params: parsed.params },
    ]);
    await db.pg.query(`insert into public.mensajes (user_id, texto) values ($1, 'de u1')`, [U1]);
    const listed = await queueChangeSource(db.pg, authenticatorDb).listChanges({ maxChanges: 100, maxRecordBytes: 1_048_576 });
    expect(listed!.rows).toHaveLength(1);
    expect(listed!.rows[0]).toMatchObject({ type: "INSERT", subscription_ids: ["aaaaaaaa-0000-4000-8000-000000000001"] });
    expect(JSON.parse(listed!.rows[0]!.record)).toMatchObject({ user_id: U1, texto: "de u1" });

    // BRAZO DE CONTROL: sin el USAGE de authenticator en el esquema (schema.ts),
    // apply_rls no sigue tras volver al usuario de la sesión.
    await as(ADMIN);
    await db.pg.exec(`revoke usage on schema realtime from authenticator`);
    await as("postgres");
    await db.pg.query(`insert into public.mensajes (user_id, texto) values ($1, 'otra')`, [U1]);
    await expect(queueChangeSource(db.pg, authenticatorDb).listChanges({ maxChanges: 100, maxRecordBytes: 1_048_576 })).rejects.toThrow(/permission denied for schema realtime/);
    await db.pg.close();
  });

  // Su función `list_changes` lleva `SET log_min_messages TO 'fatal'`, un
  // parámetro de superusuario: Supabase le da `SET ON PARAMETER` a su rol. Aquí
  // sólo root puede dárselo al administrador (setup-pages-cluster.sh).
  it("BRAZO DE CONTROL: sin el SET ON PARAMETER log_min_messages de root, el administrador no puede crear list_changes", async () => {
    await cluster("");
    await expect(ensureRealtimeProvisioned({ scope: REF, ref: REF })).rejects.toThrow(/permission denied to set parameter "log_min_messages"/);
    await as("postgres");
    const r = await db.pg.query<{ ok: boolean }>(`select to_regclass('realtime.subscription') is not null as ok`);
    expect(r.rows[0]!.ok).toBe(false);
    await db.pg.close();
  });
});
