// @vitest-environment node
//
// Entrar como un usuario de la página en la visita de Len (`use_page`), como
// lo hace Lovable: si la app tiene un solo usuario, entra como ése; si tiene
// varios y no se dijo cuál, no entra y pregunta; nunca crea una cuenta. La
// sesión es una de verdad de GoTrue, y se prueba con la LIBRERÍA REAL:
// supabase-js la encuentra en su almacenamiento y RLS ve a ese usuario.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it } from "vitest";

import { handleBackendRequest } from "../router";
import { newTestProject, TEST_REF, TEST_URL, type TestProject } from "../testing/project";
import { ONLY_USER, signInForVisit, supabaseStorageKey } from "./visit-session";

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

let t: TestProject;

beforeEach(async () => {
  t = await newTestProject(MIGRATION);
});

/** La página: supabase-js con su clave publicable y su almacenamiento (el
 *  `localStorage` de la visita), con lo que ya tenga guardado. */
function pageClient(stored: Map<string, string>): SupabaseClient {
  return createClient(TEST_URL, t.project.publishableKey, {
    global: { fetch: (input, init) => handleBackendRequest(new Request(input, init), t.project) },
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
}

async function createUser(email: string): Promise<string> {
  const admin = createClient(TEST_URL, t.secretKey, {
    global: { fetch: (input, init) => handleBackendRequest(new Request(input, init), t.project) },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await admin.auth.admin.createUser({ email, password: "una-clave-larga-1", email_confirm: true });
  if (error || !data.user) throw error ?? new Error("sin usuario");
  return data.user.id;
}

const countRows = async (table: string) =>
  Number((await t.pg.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0]!.n);

describe("entrar como un usuario de la página en la visita de Len", () => {
  it("🔴 con un solo usuario entra como él: supabase-js encuentra la sesión y RLS la ve", async () => {
    const anaId = await createUser("ana@tiendaluna.mx");
    const r = await signInForVisit(t.project, ONLY_USER);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.email).toBe("ana@tiendaluna.mx");

    const signedIn = pageClient(new Map([[supabaseStorageKey(TEST_URL), JSON.stringify(r.session)]]));
    expect((await signedIn.auth.getUser()).data.user?.id).toBe(anaId);
    const note = await signedIn.from("notas").insert({ texto: "hola" }).select("user_id").single();
    expect(note.error).toBeNull();
    expect(note.data?.user_id).toBe(anaId);

    // Brazo de control: la misma página sin nada guardado no es nadie.
    const anonymous = pageClient(new Map());
    expect((await anonymous.auth.getUser()).data.user).toBeNull();
    expect((await anonymous.from("notas").insert({ texto: "hola" })).error).not.toBeNull();
  }, 30_000);

  it("la clave es la que supabase-js usa por defecto para la URL del proyecto", () => {
    expect(supabaseStorageKey(TEST_URL)).toBe(`sb-${TEST_REF}-auth-token`);
  });

  it("🔴 con varios y sin decir cuál, no entra: los nombra para preguntar, y no abre sesión", async () => {
    await createUser("ana@tiendaluna.mx");
    await createUser("beto@tiendaluna.mx");
    const r = await signInForVisit(t.project, ONLY_USER);
    expect(r).toMatchObject({ ok: false, reason: "pick_one", total: 2 });
    if (r.ok || r.reason !== "pick_one") return;
    expect([...r.emails].sort()).toEqual(["ana@tiendaluna.mx", "beto@tiendaluna.mx"]);
    expect(await countRows("auth.sessions")).toBe(0);
  }, 30_000);

  it("con su correo entra como ése, sin distinguir mayúsculas", async () => {
    await createUser("ana@tiendaluna.mx");
    const betoId = await createUser("beto@tiendaluna.mx");
    const r = await signInForVisit(t.project, "Beto@TiendaLuna.mx");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.email).toBe("beto@tiendaluna.mx");
    const signedIn = pageClient(new Map([[supabaseStorageKey(TEST_URL), JSON.stringify(r.session)]]));
    expect((await signedIn.auth.getUser()).data.user?.id).toBe(betoId);
  }, 30_000);

  it("🔴 un correo que no es de nadie no entra ni crea la cuenta: dice quién hay", async () => {
    await createUser("ana@tiendaluna.mx");
    const r = await signInForVisit(t.project, "nadie@tiendaluna.mx");
    expect(r).toMatchObject({ ok: false, reason: "not_found", emails: ["ana@tiendaluna.mx"], total: 1 });
    expect(await countRows("auth.users")).toBe(1);
    expect(await countRows("auth.sessions")).toBe(0);
  }, 30_000);

  it("sin usuarios lo dice", async () => {
    expect(await signInForVisit(t.project, ONLY_USER)).toEqual({ ok: false, reason: "no_users" });
  }, 30_000);

  it("🔴 un usuario vetado no se elige: ni como el único ni por su correo", async () => {
    const anaId = await createUser("ana@tiendaluna.mx");
    await t.pg.query(`update auth.users set banned_until = now() + interval '1 day' where id = $1`, [anaId]);
    expect(await signInForVisit(t.project, ONLY_USER)).toEqual({ ok: false, reason: "no_users" });
    expect(await signInForVisit(t.project, "ana@tiendaluna.mx")).toEqual({ ok: false, reason: "banned" });
    expect(await countRows("auth.sessions")).toBe(0);
  }, 30_000);

  it("🔴 al acabar la visita la sesión se cierra: su token deja de valer", async () => {
    await createUser("ana@tiendaluna.mx");
    const r = await signInForVisit(t.project, ONLY_USER);
    if (!r.ok) throw new Error("no entró");
    const stored = new Map([[supabaseStorageKey(TEST_URL), JSON.stringify(r.session)]]);
    expect((await pageClient(stored).auth.getUser()).error).toBeNull();
    await r.end();
    // El servidor: 403 `session_not_found`, como GoTrue.
    const raw = await handleBackendRequest(
      new Request(`${TEST_URL}/auth/v1/user`, {
        headers: { apikey: t.project.publishableKey, authorization: `Bearer ${String(r.session.access_token)}` },
      }),
      t.project,
    );
    expect(raw.status).toBe(403);
    expect(await raw.json()).toMatchObject({ error_code: "session_not_found" });
    // supabase-js: lo da por sesión perdida y la borra de su almacenamiento.
    const after = await pageClient(stored).auth.getUser();
    expect(after.error?.name).toBe("AuthSessionMissingError");
    expect(stored.has(supabaseStorageKey(TEST_URL))).toBe(false);
    expect(await countRows("auth.sessions")).toBe(0);
  }, 30_000);
});
