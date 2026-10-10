// La base de un proyecto, montada como la de Supabase (plans/pages-backend/design.md).
//
// De dónde sale cada línea:
//   · Los roles y permisos: `supabase/postgres` @ e6090216,
//     migrations/db/init-scripts/00000000000000-initial-schema.sql,
//     00000000000001-auth-schema.sql y 00000000000003-post-setup.sql
//     (licencia PostgreSQL).
//   · El esquema `auth`: las migraciones de GoTrue, tal cual
//     (./sql/gotrue-migrations.ts, MIT).
//
// LA ÚNICA ADAPTACIÓN: en Supabase cada proyecto es un clúster entero y su
// desarrollador es el rol `postgres`. Aquí un clúster lleva muchos proyectos,
// una BASE cada uno, y los roles son del clúster: `postgres` sería el
// superusuario de todos. Por eso cada proyecto tiene su rol de desarrollador
// (`ol_<ref>`), y donde Supabase dice `postgres` aquí va ese rol. `anon`,
// `authenticated`, `service_role` y `authenticator` son los de Supabase, con
// sus nombres: son los que escribe Len en sus políticas. Una conexión a la base
// de un proyecto no alcanza la de otro, así que compartirlos no mezcla nada.

import type { SqlRunner } from "./db";
import { GOTRUE_MIGRATIONS } from "./sql/gotrue-migrations";

/** Una vez por clúster. Idempotente. */
export const CLUSTER_ROLES_SQL = `
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit;
  end if;
end $$;
grant anon to authenticator;
grant authenticated to authenticator;
grant service_role to authenticator;
grant supabase_auth_admin to authenticator;
alter role anon set statement_timeout = '3s';
alter role authenticated set statement_timeout = '8s';
`;

/** El nombre de un rol de desarrollador: sólo lo generamos nosotros, pero va
 *  pegado en SQL, así que se comprueba igual. */
const DEV_ROLE_RE = /^ol_[a-z]{20}$/;

const NAMESPACE_RE = /\{\{\s*index \.Options "Namespace"\s*\}\}/g;

/** Las migraciones de GoTrue con su esquema puesto. Una sola concede permisos
 *  a `postgres` (20240612123726_enable_rls_update_grants): ahí va el rol de
 *  desarrollador del proyecto, que es quien hace de `postgres`. */
export function gotrueMigrationSql(sql: string, devRole: string): string {
  return sql.replace(NAMESPACE_RE, "auth").replace(/\bto postgres\b/g, `to ${devRole}`);
}

/** Monta la base de UN proyecto, recién creada y conectados como su dueño
 *  (el administrador del clúster). El rol de desarrollador ya existe. */
/** 00000000000003-post-setup.sql: ALTER ROLE postgres SET search_path … Es un
 *  ajuste del ROL (de las dos bases del proyecto), no de una base. */
export function devRoleSettingsSql(devRole: string): string {
  if (!DEV_ROLE_RE.test(devRole)) throw new Error(`rol de desarrollador no válido: ${devRole}`);
  return `alter role ${devRole} set search_path to "$user", public, extensions;`;
}

/** `roleSettings: false` cuando quien llama ya ajustó el rol (provisionDatabase,
 *  bajo el candado de los roles del clúster: cluster-roles-lock.ts). */
export async function initProjectDatabase(db: SqlRunner, opts: { devRole: string; roleSettings?: boolean }): Promise<void> {
  const dev = opts.devRole;
  if (!DEV_ROLE_RE.test(dev)) throw new Error(`rol de desarrollador no válido: ${dev}`);

  // 00000000000000-initial-schema.sql
  await db.exec(`
    create schema if not exists extensions;
    create extension if not exists "uuid-ossp" with schema extensions;
    create extension if not exists pgcrypto with schema extensions;

    alter schema public owner to ${dev};
    grant usage on schema public to ${dev}, anon, authenticated, service_role;
    alter default privileges for role ${dev} in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges for role ${dev} in schema public grant all on functions to anon, authenticated, service_role;
    alter default privileges for role ${dev} in schema public grant all on sequences to anon, authenticated, service_role;

    grant usage on schema extensions to ${dev}, anon, authenticated, service_role;
  `);

  // Supabase corre en UTC: las fechas salen `…+00:00`. Para las conexiones
  // nuevas (ALTER DATABASE) y para ésta.
  await db.exec(`
    do $$ begin execute format('alter database %I set timezone to %L', current_database(), 'UTC'); end $$;
    set timezone to 'UTC';
  `);

  if (opts.roleSettings !== false) await db.exec(devRoleSettingsSql(dev));

  // 00000000000001-auth-schema.sql (el esquema) + las migraciones de GoTrue,
  // aplicadas CON el rol de GoTrue, como en Supabase: así `supabase_auth_admin`
  // es el dueño de sus tablas, y el RLS que esas mismas migraciones activan en
  // ellas (20240612123726) no le aplica a él.
  await db.exec(`create schema if not exists auth authorization supabase_auth_admin;`);
  for (const m of GOTRUE_MIGRATIONS) {
    await db.exec(`set role supabase_auth_admin;
${gotrueMigrationSql(m.sql, dev)}
;reset role;`);
  }
  for (const m of GOTRUE_MIGRATIONS) {
    await db.query(`insert into auth.schema_migrations (version) values ($1) on conflict do nothing`, [m.version]);
  }
  await db.exec(`
    grant usage on schema auth to ${dev}, anon, authenticated, service_role;
    -- El patrón de perfiles de Supabase: \`references auth.users\` y el trigger
    -- \`on_auth_user_created\` los escribe el desarrollador.
    grant references, trigger on auth.users to ${dev};
  `);

  // La tabla con la que la CLI de Supabase lleva las migraciones aplicadas
  // (\`supabase db push\`).
  await db.exec(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text not null primary key,
      statements text[],
      name text
    );
    grant usage on schema supabase_migrations to ${dev};
    grant select, insert on supabase_migrations.schema_migrations to ${dev};
  `);
}
