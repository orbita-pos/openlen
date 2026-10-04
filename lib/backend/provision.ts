// Crear la base de un proyecto en el clúster de las páginas, la primera vez que
// la necesita (como Lovable Cloud: «provisioned automatically when your project
// needs it»). Idempotente: se puede llamar cada vez.
//
//   1. En `postgres`: los roles del clúster, la contraseña de `authenticator`,
//      el rol de desarrollador del proyecto y su base; CONNECT sólo para él y
//      para `authenticator`.
//   2. En la base nueva, en UNA transacción: `initProjectDatabase` (el DDL de
//      Postgres es transaccional: si algo falla no queda una base a medias).

import "server-only";

import { CLUSTER_ROLES_SQL, initProjectDatabase } from "./schema";
import { withAdmin } from "./pg";
import { literal } from "./rest/sql";

const REF_RE = /^[a-z]{20}$/;

export function devRoleOf(ref: string): string {
  if (!REF_RE.test(ref)) throw new Error(`ref no válido: ${ref}`);
  return `ol_${ref}`;
}

export async function provisionDatabase(opts: { ref: string; dbPassword: string }): Promise<void> {
  const dev = devRoleOf(opts.ref);
  const dbName = dev;
  if (!/^[A-Za-z0-9_-]+$/.test(opts.dbPassword)) throw new Error("contraseña de base con caracteres inesperados");
  const authenticatorPassword = process.env.PAGES_AUTHENTICATOR_PASSWORD ?? "";

  await withAdmin("postgres", async (r) => {
    // Dos peticiones a la vez no pueden crear la misma base.
    await r.query(`select pg_advisory_lock(hashtext($1))`, [`pages-backend:${opts.ref}`]);
    try {
      await r.exec(CLUSTER_ROLES_SQL);
      await r.exec(`alter role authenticator with login password ${literal(authenticatorPassword)};`);
      const role = await r.query(`select 1 from pg_roles where rolname = $1`, [dev]);
      if (role.rows.length === 0) {
        await r.exec(`create role ${dev} login noinherit nosuperuser nocreatedb nocreaterole nobypassrls password ${literal(opts.dbPassword)};`);
      }
      const db = await r.query(`select 1 from pg_database where datname = $1`, [dbName]);
      if (db.rows.length === 0) await r.exec(`create database ${dbName};`);
      await r.exec(`revoke connect on database ${dbName} from public; grant connect on database ${dbName} to ${dev}, authenticator;`);
    } finally {
      await r.query(`select pg_advisory_unlock(hashtext($1))`, [`pages-backend:${opts.ref}`]);
    }
  });

  await withAdmin(dbName, async (r) => {
    const ready = await r.query(`select to_regclass('auth.users') is not null as ok`);
    if (ready.rows[0]?.ok === true) return;
    await r.exec("BEGIN");
    try {
      await initProjectDatabase(r, { devRole: dev });
      await r.exec("COMMIT");
    } catch (err) {
      await r.exec("ROLLBACK").catch(() => {});
      throw err;
    }
  });
}
