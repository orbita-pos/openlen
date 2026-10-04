// @vitest-environment node
//
// La base de un proyecto, montada como la de Supabase: los roles de su
// arranque, el esquema `auth` de GoTrue entero y el rol de desarrollador del
// proyecto. Lo que se prueba es lo que Len escribe de verdad: el patrón de
// perfiles de la documentación de Supabase (tabla con `references auth.users`,
// trigger `on_auth_user_created`, RLS con `auth.uid()`), ejecutado con el rol
// con el que se aplicarán sus migraciones.
import { beforeAll, describe, expect, it } from "vitest";

import { asRole, newTestDatabase } from "./testing/pglite";
import { CLUSTER_ROLES_SQL, initProjectDatabase } from "./schema";
import { GOTRUE_MIGRATIONS } from "./sql/gotrue-migrations";

const DEV = "ol_abcdefghijklmnopqrst";
const ANA = "11111111-1111-1111-1111-111111111111";
const BEA = "22222222-2222-2222-2222-222222222222";

// El patrón de https://supabase.com/docs/guides/auth/managing-user-data, tal cual.
const MIGRACION_DE_LEN = `
create table public.profiles (
  id uuid not null references auth.users on delete cascade,
  first_name text,
  primary key (id)
);
alter table public.profiles enable row level security;
create policy "Users can view their own profile" on public.profiles
  for select using ((select auth.uid()) = id);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, first_name)
  values (new.id, new.raw_user_meta_data ->> 'first_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
`;

const { pg, runner } = newTestDatabase();

beforeAll(async () => {
  await runner.exec(CLUSTER_ROLES_SQL);
  await runner.exec(`create role ${DEV} nologin noinherit`);
  await initProjectDatabase(runner, { devRole: DEV });
});

describe("la base de un proyecto", () => {
  it("lleva el esquema auth de GoTrue entero, con sus versiones apuntadas", async () => {
    const tablas = (await runner.query(`select table_name from information_schema.tables where table_schema = 'auth'`)).rows.map(
      (r) => r.table_name,
    );
    expect(tablas).toEqual(expect.arrayContaining(["users", "sessions", "refresh_tokens", "identities", "one_time_tokens"]));
    const versiones = (await runner.query(`select version from auth.schema_migrations`)).rows.map((r) => r.version);
    expect(versiones).toEqual(expect.arrayContaining(GOTRUE_MIGRATIONS.map((m) => m.version)));
  });

  it("lleva la tabla de migraciones de la CLI de Supabase", async () => {
    const cols = (
      await runner.query(
        `select column_name from information_schema.columns where table_schema = 'supabase_migrations' and table_name = 'schema_migrations' order by ordinal_position`,
      )
    ).rows.map((r) => r.column_name);
    expect(cols).toEqual(["version", "statements", "name"]);
  });

  it("🔴 el rol de desarrollador aplica el patrón de perfiles de Supabase", async () => {
    const r = await asRole(pg, DEV, null, async (q) => {
      await q(MIGRACION_DE_LEN);
      return "ok";
    });
    expect(r).toBe("ok");
  });

  it("🔴 alta en auth.users → el trigger crea el perfil, y RLS deja a cada quien ver sólo el suyo", async () => {
    // Como lo hará /auth/v1/signup: inserta en auth.users.
    for (const [id, nombre] of [[ANA, "Ana"], [BEA, "Bea"]] as const) {
      await runner.query(
        `insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
         values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, $3, now(), now())`,
        [id, `${nombre.toLowerCase()}@correo.mx`, JSON.stringify({ first_name: nombre })],
      );
    }
    const deAna = await asRole(pg, "authenticated", { sub: ANA, role: "authenticated" }, (q) => q(`select first_name from public.profiles`));
    expect(deAna).toEqual([{ first_name: "Ana" }]);
    const anon = await asRole(pg, "anon", null, (q) => q(`select first_name from public.profiles`));
    expect(anon).toEqual([]);
    const servicio = await asRole(pg, "service_role", null, (q) => q(`select first_name from public.profiles order by 1`));
    expect(servicio).toEqual([{ first_name: "Ana" }, { first_name: "Bea" }]);
  });

  it("BRAZO DE CONTROL: anon y authenticated no leen auth.users", async () => {
    for (const role of ["anon", "authenticated"]) {
      const r = await asRole(pg, role, { sub: ANA, role }, (q) => q(`select email from auth.users`));
      expect(r, role).toMatchObject({ code: "42501" });
    }
  });

  it("una tabla nueva del desarrollador queda al alcance de la API (los permisos por defecto de Supabase); RLS decide", async () => {
    await asRole(pg, DEV, null, (q) => q(`create table public.notas (id bigint generated always as identity primary key, texto text)`));
    const r = await asRole(pg, "anon", null, async (q) => {
      await q(`insert into public.notas (texto) values ('hola')`);
      return q(`select texto from public.notas`);
    });
    expect(r).toEqual([{ texto: "hola" }]);
  });

  it("el rol de desarrollador no es superusuario ni crea roles ni bases", async () => {
    const r = await runner.query(`select rolsuper, rolcreaterole, rolcreatedb, rolbypassrls from pg_roles where rolname = $1`, [DEV]);
    expect(r.rows[0]).toEqual({ rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolbypassrls: false });
  });
});
