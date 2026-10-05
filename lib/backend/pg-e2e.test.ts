// @vitest-environment node
//
// De punta a punta contra un Postgres DE VERDAD, no PGlite: el alta de la base
// (`provisionDatabase`), las peticiones con `authenticator` por su pool, el rol
// de desarrollador corriendo una migración, RLS con supabase-js real, y entrar
// como un usuario en la visita de Len. Lo que PGlite no ve: el driver `pg`,
// los roles de LOGIN, CONNECT por base y dos conexiones a la vez.
//
// Sólo corre con PAGES_E2E_DATABASE_URL, la URL de administrador de un clúster
// de USAR Y TIRAR (crea roles de clúster y bases). Sin ella se salta. Así se
// corrió el 04/10, con un Postgres 17 aparte en el puerto 5544:
//   initdb -D <dir> -U postgres --auth=trust && pg_ctl -D <dir> -o "-p 5544" start
//   PAGES_E2E_DATABASE_URL=postgres://postgres@127.0.0.1:5544/postgres npx vitest run lib/backend/pg-e2e.test.ts
import { randomBytes } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { defaultAuthConfig, type AuthMail } from "./auth/config";
import { ONLY_USER, signInForVisit, supabaseStorageKey } from "./auth/visit-session";
import { hashSecretKey, newDatabasePassword, newJwtSecret, newProjectRef, newPublishableKey, newSecretKey } from "./keys";
import { projectDatabase, withAdmin, withDeveloper } from "./pg";
import { devRoleOf, dropProjectDatabase, provisionDatabase } from "./provision";
import { handleBackendRequest, type BackendProject } from "./router";

const E2E_URL = process.env.PAGES_E2E_DATABASE_URL;

const MIGRATION = `
create table public.notas (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  texto text not null
);
alter table public.notas enable row level security;
create policy "mis notas" on public.notas for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
`;

describe.skipIf(!E2E_URL)("el backend de las páginas contra un Postgres de verdad", () => {
  const ref = newProjectRef();
  const dev = devRoleOf(ref);
  const dbPassword = newDatabasePassword();
  const secretKey = newSecretKey();
  const projectUrl = `https://${ref}.openlen.app`;
  const mails: AuthMail[] = [];
  let project: BackendProject;

  beforeAll(async () => {
    process.env.PAGES_DATABASE_URL = E2E_URL;
    process.env.PAGES_AUTHENTICATOR_PASSWORD = randomBytes(18).toString("base64url");
    await provisionDatabase({ ref, dbPassword });
    project = {
      ref,
      publishableKey: newPublishableKey(),
      secretKeyHash: hashSecretKey(secretKey),
      jwtSecret: newJwtSecret(),
      db: projectDatabase(dev),
      auth: {
        config: { ...defaultAuthConfig(`${projectUrl}/auth/v1`), siteUrl: "https://tienda.openlen.app" },
        sendMail: async (m) => {
          mails.push(m);
        },
      },
    };
  }, 120_000);

  afterAll(async () => {
    if (!E2E_URL) return;
    await dropProjectDatabase(ref);
  }, 60_000);

  const client = (key: string, stored = new Map<string, string>()): SupabaseClient =>
    createClient(projectUrl, key, {
      global: { fetch: (input, init) => handleBackendRequest(new Request(input, init), project) },
      auth: {
        storage: {
          getItem: (k) => stored.get(k) ?? null,
          setItem: (k, v) => void stored.set(k, v),
          removeItem: (k) => void stored.delete(k),
        },
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

  it("dar de alta la base dos veces no rompe nada, y deja el esquema de GoTrue", async () => {
    await provisionDatabase({ ref, dbPassword });
    const ok = await withAdmin(dev, (r) => r.query(`select to_regclass('auth.users') is not null as ok`));
    expect(ok.rows[0]?.ok).toBe(true);
  }, 60_000);

  it("🔴 el rol de desarrollador migra, y RLS separa lo de cada usuario con supabase-js", async () => {
    await withDeveloper(dev, dev, dbPassword, (r) => r.exec(MIGRATION));
    const admin = client(secretKey);
    for (const email of ["ana@tiendaluna.mx", "beto@tiendaluna.mx"]) {
      const { error } = await admin.auth.admin.createUser({ email, password: "una-clave-larga-1", email_confirm: true });
      expect(error).toBeNull();
    }
    const ana = client(project.publishableKey);
    expect((await ana.auth.signInWithPassword({ email: "ana@tiendaluna.mx", password: "una-clave-larga-1" })).error).toBeNull();
    expect((await ana.from("notas").insert({ texto: "de ana" })).error).toBeNull();

    const beto = client(project.publishableKey);
    await beto.auth.signInWithPassword({ email: "beto@tiendaluna.mx", password: "una-clave-larga-1" });
    expect((await beto.from("notas").select("texto")).data).toEqual([]);
    expect((await ana.from("notas").select("texto")).data).toEqual([{ texto: "de ana" }]);
    // Sin sesión, nada.
    expect((await client(project.publishableKey).from("notas").select("texto")).data).toEqual([]);
  }, 60_000);

  it("🔴 una migración puede crear su esquema, como `postgres` en Supabase (el `private` de las funciones security definer)", async () => {
    await withDeveloper(dev, dev, dbPassword, (r) =>
      r.exec(`
        create schema private;
        create function private.cuantas_notas() returns bigint language sql security definer set search_path = '' as
          $$ select count(*) from public.notas $$;
      `),
    );
    const n = await withDeveloper(dev, dev, dbPassword, (r) => r.query(`select private.cuantas_notas() as n`));
    expect(Number(n.rows[0]?.n)).toBe(1);
  }, 60_000);

  it("registrarse manda el correo de confirmación (por el buzón de la prueba)", async () => {
    const { error } = await client(project.publishableKey).auth.signUp({ email: "caro@tiendaluna.mx", password: "una-clave-larga-1" });
    expect(error).toBeNull();
    expect(mails.some((m) => m.to === "caro@tiendaluna.mx" && m.kind === "signup")).toBe(true);
  }, 60_000);

  it("🔴 la visita de Len entra por su correo con una sesión de verdad, y al acabar se cierra", async () => {
    // Hay tres usuarios: sin decir cuál, no entra.
    expect(await signInForVisit(project, ONLY_USER)).toMatchObject({ ok: false, reason: "pick_one", total: 3 });
    const r = await signInForVisit(project, "ana@tiendaluna.mx");
    if (!r.ok) throw new Error(`no entró: ${r.reason}`);
    const stored = new Map([[supabaseStorageKey(projectUrl), JSON.stringify(r.session)]]);
    const page = client(project.publishableKey, stored);
    expect((await page.from("notas").select("texto")).data).toEqual([{ texto: "de ana" }]);
    const sessions = await withAdmin(dev, (q) => q.query(`select user_agent from auth.sessions where user_agent like 'OpenLen%'`));
    expect(sessions.rows).toHaveLength(1);
    await r.end();
    const after = await withAdmin(dev, (q) => q.query(`select count(*)::int as n from auth.sessions where user_agent like 'OpenLen%'`));
    expect(after.rows[0]?.n).toBe(0);
  }, 60_000);
  // 🔴 BORRAR UN PROYECTO SE LLEVA SU BASE. Hasta el 04/10, `deleteProject`
  // borraba la fila de `projectBackends` (en cascada) y dejaba en el clúster la
  // base y el rol `ol_<ref>`, con las cuentas de los visitantes dentro —correo,
  // contraseña con hash, la IP de cada sesión— y ya sin dueño que pudiera
  // verlas ni borrarlas.
  //
  // Y sin cerrar antes los pools de ESTE proceso: el `with (force)` del borrado
  // les mata las conexiones ociosas y cada una sale como «conexión rota» en el
  // registro (se veía en el afterAll de este mismo fichero).
  it("🔴 borrar la base de un proyecto se lleva la base y su rol, sin dejar conexiones rotas", async () => {
    const otro = newProjectRef();
    const otroDev = devRoleOf(otro);
    await provisionDatabase({ ref: otro, dbPassword: newDatabasePassword() });
    await projectDatabase(otroDev).transaction((q) => q("select 1"));
    await withAdmin(otroDev, (r) => r.query("select 1"));

    const errores: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void errores.push(a));
    try {
      await dropProjectDatabase(otro);
      await new Promise((r) => setTimeout(r, 300));
    } finally {
      spy.mockRestore();
    }

    const quedan = await withAdmin("postgres", (r) =>
      r.query(
        `select (select count(*) from pg_database where datname = $1)::int as bases,
                (select count(*) from pg_roles where rolname = $1)::int as roles`,
        [otroDev],
      ),
    );
    expect(quedan.rows[0]).toEqual({ bases: 0, roles: 0 });
    expect(errores).toEqual([]);
    // Otra vez: ya no hay nada que borrar, y no falla.
    await dropProjectDatabase(otro);
  }, 60_000);

  /* ── carril D: storage (lib/backend/storage) ── Lo que PGlite no ve: el
   * admin del clúster NO es superusuario, y el desarrollador entra con SU rol
   * (session_user), así que `set role` se comprueba de verdad. */
  it("🔴 Storage: el esquema se monta con este admin, el desarrollador crea su bucket y su política, y no puede hacerse supabase_storage_admin", async () => {
    const { ensureStorageProvisioned, forgetStorageProvisioned } = await import("./storage/provision");
    forgetStorageProvisioned();
    await ensureStorageProvisioned(ref);
    forgetStorageProvisioned();
    await ensureStorageProvisioned(ref); // otra vez, en otro «proceso»: no rompe
    const n = await withAdmin(dev, (r) => r.query(`select count(*)::int as n from storage.migrations`));
    expect(n.rows[0]?.n).toBe(73);

    await withDeveloper(dev, dev, dbPassword, (r) =>
      r.exec(`
        insert into storage.buckets (id, name, public) values ('avatars', 'avatars', false);
        create policy "subir a lo tuyo" on storage.objects for insert to authenticated
          with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));
        create policy "ver lo tuyo" on storage.objects for select to authenticated
          using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));
      `),
    );
    const sinPermiso = await withDeveloper(dev, dev, dbPassword, (r) => r.exec(`set role supabase_storage_admin`)).catch((e: unknown) => e);
    expect(String(sinPermiso)).toMatch(/permission denied to set role/);
    const sinRoles = await withDeveloper(dev, dev, dbPassword, (r) => r.exec(`create role intruso`)).catch((e: unknown) => e);
    expect(String(sinRoles)).toMatch(/permission denied to create role/);
  }, 120_000);

  it("🔴 Storage con supabase-js por el pool de authenticator: cada uno sube y baja lo suyo", async () => {
    const { MemoryBlobStore } = await import("./storage/blob-store");
    const store = new MemoryBlobStore();
    const conStorage: BackendProject = { ...project, storage: { store } };
    const ana = createClient(projectUrl, project.publishableKey, {
      global: { fetch: (input, init) => handleBackendRequest(new Request(input, init), conStorage) },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: s } = await ana.auth.signInWithPassword({ email: "ana@tiendaluna.mx", password: "una-clave-larga-1" });
    const uid = s.user!.id;
    const up = await ana.storage.from("avatars").upload(`${uid}/foto.png`, new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }));
    expect(up.error).toBeNull();
    const otra = await ana.storage.from("avatars").upload(`otro/foto.png`, new Blob([new Uint8Array([1])], { type: "image/png" }));
    expect(otra.error).toMatchObject({ statusCode: "403" });
    const down = await ana.storage.from("avatars").download(`${uid}/foto.png`);
    expect([...new Uint8Array(await down.data!.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(store.keys()).toHaveLength(1);
  }, 60_000);
  /* ── fin carril D ── */
});
