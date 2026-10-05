// El esquema `storage` de Supabase en la base de un proyecto
// (plans/len-agente-2026/plan-2-5/d-storage.md, Tarea 2).
//
// De dónde sale cada línea:
//   · Las migraciones: las de `supabase/storage` tal cual (./migrations.ts,
//     Apache-2.0), aplicadas como su corredor (`src/internal/database/
//     migrations/migrate.ts`): las mismas `storage.*` de configuración, sus
//     directivas (`ignore`, `generate-sql`), su `DisableConcurrentIndexTransformer`
//     y con `search_path = storage`, como rol `supabase_storage_admin`.
//   · Los roles y permisos alrededor: `supabase/postgres` @ e6090216,
//     init-scripts/00000000000002-storage-schema.sql y las migraciones
//     20250623125453 y 20250709135250 (licencia PostgreSQL).
//
// LAS ADAPTACIONES, como en lib/backend/schema.ts:
//   · Donde Supabase dice `postgres` va el rol de desarrollador del proyecto.
//   · Supabase deja a `postgres` crear políticas en `storage.objects` con la
//     extensión `supautils` (`policy_grants`), que aquí no hay; antes de 2025 lo
//     hacía con `grant supabase_storage_admin to postgres` (20220609081115).
//     Aquí, ese mismo grant con `inherit true, set false`: hereda ser dueño de
//     las tablas (crear políticas) y no puede `set role supabase_storage_admin`.
//   · `supabase_storage_admin` es un rol del clúster: sin CREATEROLE ni LOGIN
//     (con CREATEROLE cualquier proyecto podría crear roles) y sin
//     `grant authenticator to supabase_storage_admin` (20231013070755), que le
//     daría los demás roles.

import { createHash } from "node:crypto";

import type { SqlRunner } from "../db";
import { STORAGE_MIGRATIONS } from "./migrations";

/** Una vez por clúster, en `postgres`. Idempotente. `authenticator` (la
 *  conexión de la API) puede `set local role` a él para lo que no es del
 *  usuario, como hace con `supabase_auth_admin`. */
export const STORAGE_CLUSTER_ROLES_SQL = `
do $$ begin
  if not exists (select from pg_roles where rolname = 'supabase_storage_admin') then
    create role supabase_storage_admin nologin noinherit;
  end if;
end $$;
grant supabase_storage_admin to authenticator;
`;

const DEV_ROLE_RE = /^ol_[a-z]{20}$/;

// src/internal/database/migrations/transformers/disable-concurrent-index-transformer.ts
const CONCURRENT_INDEX_FIND = "INDEX CONCURRENTLY";
const DISABLE_TRANSACTION_STRING = "-- postgres-migrations disable-transaction";

/** Lo que hace su `DisableConcurrentIndexTransformer`: aquí todo el esquema
 *  entra en UNA transacción (una base a medias no se queda). */
export function storageMigrationSql(m: { readonly sql: string }): string {
  if (!m.sql.includes(CONCURRENT_INDEX_FIND)) return m.sql;
  return m.sql.replaceAll(CONCURRENT_INDEX_FIND, "INDEX").replace(DISABLE_TRANSACTION_STRING, "");
}

const AS_STORAGE_ADMIN = "set role supabase_storage_admin; set search_path to storage, public, extensions;";
const BACK = ";reset role; reset search_path;";

/** Monta el esquema `storage` en la base de UN proyecto, conectados como su
 *  dueño (el administrador del clúster). El rol de desarrollador y
 *  `supabase_storage_admin` ya existen. Idempotente. */
export async function initStorageSchema(db: SqlRunner, opts: { devRole: string }): Promise<void> {
  const dev = opts.devRole;
  if (!DEV_ROLE_RE.test(dev)) throw new Error(`rol de desarrollador no válido: ${dev}`);

  const ready = await db.query(`select to_regclass('storage.objects') is not null as ok`);
  if (ready.rows[0]?.ok === true) return;

  // init-scripts/00000000000002-storage-schema.sql, con `postgres` → dev. Los
  // permisos por defecto, para lo que cree `supabase_storage_admin` (el que
  // corre las migraciones).
  await db.exec(`
    create schema if not exists storage authorization supabase_storage_admin;
    grant usage on schema storage to ${dev}, anon, authenticated, service_role;
    alter default privileges for role supabase_storage_admin in schema storage grant all on tables to ${dev}, anon, authenticated, service_role;
    alter default privileges for role supabase_storage_admin in schema storage grant all on functions to ${dev}, anon, authenticated, service_role;
    alter default privileges for role supabase_storage_admin in schema storage grant all on sequences to ${dev}, anon, authenticated, service_role;
  `);

  // Lo que pone su corredor antes de migrar (migrate.ts): los roles los crea el
  // clúster, no las migraciones.
  await db.exec(`select
    set_config('storage.install_roles', 'false', false),
    set_config('storage.multitenant', 'false', false),
    set_config('storage.anon_role', 'anon', false),
    set_config('storage.authenticated_role', 'authenticated', false),
    set_config('storage.service_role', 'service_role', false),
    set_config('storage.super_user', 'supabase_storage_admin', false);`);

  for (const m of STORAGE_MIGRATIONS) {
    if (m.sql.includes("-- postgres-migrations ignore")) continue;
    let sql = m.sql;
    if (sql.includes("-- storage-migrations generate-sql")) {
      await db.exec(AS_STORAGE_ADMIN);
      try {
        const r = await db.query(sql);
        const generated = r.rows[0]?.sql;
        if (r.rows.length !== 1 || typeof generated !== "string" || !generated.trim()) {
          throw new Error(`${m.fileName}: la migración generada no devolvió un sql`);
        }
        sql = generated;
      } finally {
        await db.exec(BACK);
      }
    }
    await db.exec(`${AS_STORAGE_ADMIN}\n${storageMigrationSql({ sql })}\n${BACK}`);
  }

  // `postgres-migrations` apunta cada una, también las `ignore` (su sql pasa a
  // `SELECT 1`, y el hash es el del fichero).
  await db.exec(AS_STORAGE_ADMIN);
  try {
    for (const m of STORAGE_MIGRATIONS) {
      const hash = createHash("sha1").update(m.fileName + m.sql, "utf8").digest("hex");
      await db.query(`insert into storage.migrations (id, name, hash) values ($1, $2, $3) on conflict do nothing`, [m.id, m.name, hash]);
    }
  } finally {
    await db.exec(BACK);
  }

  // 20250623125453 + 20250709135250, con `postgres` → dev; y la adaptación de
  // `policy_grants` (arriba).
  await db.exec(`
    grant all on storage.buckets, storage.objects to ${dev} with grant option;
    grant usage on schema storage to ${dev} with grant option;
    grant supabase_storage_admin to ${dev} with inherit true, set false;
  `);
}
