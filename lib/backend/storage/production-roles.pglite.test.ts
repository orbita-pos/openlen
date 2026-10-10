// @vitest-environment node
//
// STORAGE CON LOS ROLES DE PRODUCCIÓN, EN PGLITE (pieza 14, carril D). Las
// demás pruebas de lib/backend/storage corren como el superusuario de PGlite,
// que todo lo puede: una concesión que falte en producción ahí no se ve. Aquí
// cada uno entra con SU rol de sesión (`set session authorization`; medido el
// 05/10: PGlite deja pasar de uno a otro porque quien se conectó es
// superusuario —`reset` no vuelve, `set … postgres` sí—):
//   · el administrador del clúster, NO superusuario (CREATEDB CREATEROLE
//     BYPASSRLS y createrole_self_grant = 'set, inherit', como lo deja
//     infra/db/setup-pages-cluster.sh), corre `provisionDatabase` y
//     `ensureStorageProvisioned` DE VERDAD: `withAdmin` va a esta PGlite;
//   · el desarrollador `ol_<ref>` corre su migración, como `supabase db push`;
//   · las peticiones de supabase-js van como `authenticator`, que sólo llega a
//     anon, authenticated, service_role y supabase_storage_admin por sus grants.
// Lo que PGlite no da —el driver `pg`, LOGIN y CONNECT por base, dos conexiones
// a la vez— lo cubre lib/backend/pg-e2e.test.ts contra un Postgres de verdad
// (PAGES_E2E_DATABASE_URL).
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultAuthConfig } from "../auth/config";
import type { ProjectDatabase, SqlRunner } from "../db";
import { hashSecretKey, newJwtSecret, newPublishableKey, newSecretKey, signJwt } from "../keys";
import { handleBackendRequest, type BackendProject } from "../router";
import { pgliteProjectDatabase } from "../testing/pglite";
import { MemoryBlobStore } from "./blob-store";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const REF = "qrstuvwxyzabcdefghij";
const DEV = `ol_${REF}`;
const ADMIN = "openlen_pages_admin";
const URL_ = `https://${REF}.openlen.app`;
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

const db = vi.hoisted(() => ({ pg: null as unknown as PGlite }));

/** Entrar como `role` (el usuario de la SESIÓN, no un `set role`). La
 *  configuración por rol (`alter role … set`) sólo se aplica al conectarse:
 *  la del administrador va a mano, como la tendría su conexión. */
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

// `withAdmin` de verdad abre una conexión del administrador a esa base; aquí,
// la de PGlite, con su sesión. PGlite sólo abre `postgres`: la base del
// proyecto que crea `provisionDatabase` existe en el catálogo, pero lo del
// proyecto se monta en `postgres` (medido el 05/10: `database: <otra>` no
// arranca).
vi.mock("../pg", () => ({
  withAdmin: async (_dbName: string, fn: (r: SqlRunner) => Promise<unknown>) => {
    await as(ADMIN);
    return fn(runner);
  },
  closePools: async () => {},
}));

const { provisionDatabase } = await import("../provision");
const { ensureStorageProvisioned, forgetStorageProvisioned } = await import("./provision");

/** Las peticiones de la API: el pool de `authenticator`. */
const authenticatorDb: ProjectDatabase = {
  transaction: async (fn) => {
    await as("authenticator");
    return pgliteProjectDatabase(db.pg).transaction(fn);
  },
};

const MIGRACION = `
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', false);
create policy "subir a lo tuyo" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "ver lo tuyo" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "borrar lo tuyo" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));
`;

const store = new MemoryBlobStore();
const secretKey = newSecretKey();
const project: BackendProject = {
  ref: REF,
  publishableKey: newPublishableKey(),
  secretKeyHash: hashSecretKey(secretKey),
  jwtSecret: newJwtSecret(),
  db: authenticatorDb,
  auth: { config: { ...defaultAuthConfig(`${URL_}/auth/v1`), siteUrl: "https://tienda.openlen.app" }, sendMail: async () => {} },
  storage: { store },
};
const fetchDe = (i: RequestInfo | URL, init?: RequestInit) => handleBackendRequest(new Request(i, init), project);
async function comoUsuario(sub: string): Promise<SupabaseClient> {
  const jwt = await signJwt(project.jwtSecret, { sub, role: "authenticated", aud: "authenticated" }, 3600);
  return createClient(URL_, project.publishableKey, { global: { fetch: fetchDe }, accessToken: async () => jwt });
}
const png = (b: number) => new Blob([new Uint8Array([b, b, b])], { type: "image/png" });

/** Lo que la sesión `role` consigue con `sql`: null, o el mensaje de Postgres. */
async function intenta(role: string, sql: string): Promise<string | null> {
  await as(role);
  try {
    await db.pg.exec(sql);
    return null;
  } catch (err) {
    return (err as Error).message;
  } finally {
    await as("postgres");
  }
}

beforeAll(async () => {
  db.pg = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
  // Lo que hace root en setup-pages-cluster.sh: el administrador. Y la base
  // en la que se monta todo, suya, como la que crea él con `create database`.
  await db.pg.exec(`
    create role ${ADMIN} login createdb createrole bypassrls nosuperuser;
    alter database postgres owner to ${ADMIN};
  `);
  process.env.PAGES_AUTHENTICATOR_PASSWORD = "clave-de-prueba";
  await provisionDatabase({ scope: REF, ref: REF, dbPassword: "clave-del-desarrollador" });
  // Lo que `provisionDatabase` le concedió al desarrollador en la suya.
  await as(ADMIN);
  await db.pg.exec(`grant connect, create on database postgres to ${DEV}`);
  // Dos veces, como dos procesos: la segunda no rompe.
  forgetStorageProvisioned();
  await ensureStorageProvisioned({ scope: REF, ref: REF });
  forgetStorageProvisioned();
  await ensureStorageProvisioned({ scope: REF, ref: REF });
  // La migración de Len, con el rol del desarrollador.
  await as(DEV);
  await db.pg.exec(MIGRACION);
  await as("postgres");
});

describe("Storage con los roles de producción (sin superusuario)", () => {
  // Lo que se mira directamente en la base, como el superusuario de PGlite.
  beforeEach(() => as("postgres"));

  it("PRECONDICIÓN: nadie de los que actúan es superusuario", async () => {
    const r = await db.pg.query<{ rolname: string; rolsuper: boolean }>(
      `select rolname, rolsuper from pg_roles where rolname in ($1, $2, 'authenticator', 'supabase_storage_admin') order by 1`,
      [ADMIN, DEV],
    );
    expect(r.rows.map((x) => x.rolsuper)).toEqual([false, false, false, false]);
    expect(r.rows).toHaveLength(4);
  });

  it("el administrador limitado monta el esquema: las 73 migraciones, y sus tablas son de supabase_storage_admin", async () => {
    const m = await db.pg.query<{ n: number }>(`select count(*)::int as n from storage.migrations`);
    expect(m.rows[0]!.n).toBe(73);
    const t = await db.pg.query<{ tableowner: string }>(
      `select distinct tableowner from pg_tables where schemaname = 'storage' and tablename in ('buckets', 'objects')`,
    );
    expect(t.rows).toEqual([{ tableowner: "supabase_storage_admin" }]);
  });

  it("el desarrollador creó su bucket y sus políticas con SU sesión, y no puede hacerse supabase_storage_admin ni crear roles", async () => {
    const p = await db.pg.query<{ policyname: string }>(`select policyname from pg_policies where schemaname = 'storage' order by 1`);
    expect(p.rows.map((x) => x.policyname)).toEqual(["borrar lo tuyo", "subir a lo tuyo", "ver lo tuyo"]);
    expect(await intenta(DEV, `set role supabase_storage_admin`)).toMatch(/permission denied to set role/);
    expect(await intenta(DEV, `create role intruso`)).toMatch(/permission denied to create role/);
    expect(await intenta(DEV, `delete from storage.objects`)).toBe(
      "Direct deletion from storage tables is not allowed. Use the Storage API instead.",
    );
  });

  it("supabase-js por authenticator: cada uno sube, ve, firma y borra lo suyo, y nada de otro", async () => {
    const u1 = await comoUsuario(U1);
    const u2 = await comoUsuario(U2);
    const up = await u1.storage.from("avatars").upload(`${U1}/foto.png`, png(1));
    expect(up.error).toBeNull();
    const ajeno = await u1.storage.from("avatars").upload(`${U2}/foto.png`, png(2));
    expect(ajeno.error).toMatchObject({ statusCode: "403", message: "new row violates row-level security policy" });
    expect(store.keys()).toHaveLength(1);

    const down = await u1.storage.from("avatars").download(`${U1}/foto.png`);
    expect([...new Uint8Array(await down.data!.arrayBuffer())]).toEqual([1, 1, 1]);
    expect((await u2.storage.from("avatars").download(`${U1}/foto.png`)).error).toMatchObject({ statusCode: "404" });
    expect((await u1.storage.from("avatars").list(U1)).data?.map((f) => f.name)).toEqual(["foto.png"]);
    expect((await u2.storage.from("avatars").list(U1)).data).toEqual([]);

    const firmada = await u1.storage.from("avatars").createSignedUrl(`${U1}/foto.png`, 60);
    expect(firmada.error).toBeNull();
    const bajada = await fetchDe(firmada.data!.signedUrl);
    expect(bajada.status).toBe(200);

    expect((await u2.storage.from("avatars").remove([`${U1}/foto.png`])).data).toEqual([]);
    expect(store.keys()).toHaveLength(1);
    expect((await u1.storage.from("avatars").remove([`${U1}/foto.png`])).data).toHaveLength(1);
    expect(store.keys()).toHaveLength(0);
  });

  it("con la clave secreta (service_role por authenticator): crear y borrar un bucket", async () => {
    const admin = createClient(URL_, secretKey, { global: { fetch: fetchDe }, auth: { persistSession: false } });
    expect(await admin.storage.createBucket("fotos", { public: true })).toEqual({ data: { name: "fotos" }, error: null });
    expect((await admin.storage.deleteBucket("fotos")).data).toEqual({ message: "Successfully deleted" });
  });

  // Lo revoca quien lo concedió (el administrador): un REVOKE de otro no quita
  // la concesión de él.
  it("BRAZO DE CONTROL: sin `grant supabase_storage_admin to authenticator`, la subida no escribe su fila ni deja blob", async () => {
    await as(ADMIN);
    await db.pg.exec(`revoke supabase_storage_admin from authenticator`);
    try {
      const { error } = await (await comoUsuario(U1)).storage.from("avatars").upload(`${U1}/otra.png`, png(3));
      // 42501 → 403, la tabla de errores de Supabase (src/storage/database/errors.ts).
      expect(error).toMatchObject({ statusCode: "403", message: expect.stringMatching(/permission denied to set role "supabase_storage_admin"/) });
      expect(store.keys()).toHaveLength(0);
      await as("postgres");
      const r = await db.pg.query(`select 1 from storage.objects where name = $1`, [`${U1}/otra.png`]);
      expect(r.rows).toEqual([]);
    } finally {
      await as(ADMIN);
      await db.pg.exec(`grant supabase_storage_admin to authenticator`);
      await as("postgres");
    }
  });
});
