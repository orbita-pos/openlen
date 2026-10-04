// @vitest-environment node
//
// /auth/v1 contra la LIBRERÍA REAL: `supabase.auth` de @supabase/supabase-js
// 2.117.2, con su fetch apuntado a nuestro manejador y la base en PGlite con
// el esquema `auth` de GoTrue. Lo que Len escribe en una página —registrarse,
// confirmar el correo, entrar, recuperar, salir— y lo que RLS hace con
// `auth.uid()` después.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { handleBackendRequest } from "../router";
import { newJwtSecret, signJwt } from "../keys";
import { newTestProject, TEST_SITE, TEST_URL, type TestProject } from "../testing/project";

// El patrón de la documentación de Supabase: perfiles con trigger, y notas que
// cada usuario ve y escribe sólo suyas.
const MIGRACION = `
create table public.profiles (
  id uuid not null references auth.users on delete cascade primary key,
  nombre text
);
alter table public.profiles enable row level security;
create policy "ver el propio" on public.profiles for select using ((select auth.uid()) = id);

create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = ''
as $$ begin
  insert into public.profiles (id, nombre) values (new.id, new.raw_user_meta_data ->> 'nombre');
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

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

/** Un cliente como el de una página: guarda su sesión (en memoria). */
function cliente(key = t.project.publishableKey): SupabaseClient {
  const store = new Map<string, string>();
  return createClient(TEST_URL, key, {
    global: { fetch: (input, init) => handleBackendRequest(new Request(input, init), t.project) },
    auth: {
      storage: {
        getItem: (k) => store.get(k) ?? null,
        setItem: (k, v) => void store.set(k, v),
        removeItem: (k) => void store.delete(k),
      },
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/** El enlace del último correo a esa dirección. */
const enlace = (to: string, kind?: string) => {
  const m = [...t.mails].reverse().find((x) => x.to === to && (!kind || x.kind === kind));
  if (!m) throw new Error(`no hay correo para ${to}`);
  return m.link;
};

/** Abrir el enlace como lo abre el navegador: sin apikey, y seguir la redirección. */
async function abrir(link: string): Promise<{ status: number; location: string; fragment: URLSearchParams }> {
  const res = await handleBackendRequest(new Request(link), t.project);
  const location = res.headers.get("location") ?? "";
  return { status: res.status, location, fragment: new URLSearchParams(location.split("#")[1] ?? "") };
}

beforeAll(async () => {
  t = await newTestProject(MIGRACION);
});

describe("registrarse y confirmar el correo", () => {
  it("🔴 signUp: crea el usuario sin sesión, el trigger crea su perfil y le llega el enlace", async () => {
    const supa = cliente();
    const { data, error } = await supa.auth.signUp({
      email: "Ana@Correo.mx",
      password: "secreto-1",
      options: { data: { nombre: "Ana" }, emailRedirectTo: `${TEST_SITE}/bienvenida` },
    });
    expect(error).toBeNull();
    expect(data.session).toBeNull();
    expect(data.user).toMatchObject({
      email: "ana@correo.mx",
      aud: "authenticated",
      role: "authenticated",
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: { nombre: "Ana" },
      is_anonymous: false,
    });
    expect(data.user!.email_confirmed_at).toBeUndefined();
    expect(data.user!.identities).toHaveLength(1);
    expect(data.user!.identities![0]).toMatchObject({ provider: "email", identity_data: { email: "ana@correo.mx", sub: data.user!.id } });

    const link = new URL(enlace("ana@correo.mx", "signup"));
    expect(`${link.origin}${link.pathname}`).toBe(`${TEST_URL}/auth/v1/verify`);
    expect(link.searchParams.get("type")).toBe("signup");
    expect(link.searchParams.get("redirect_to")).toBe(`${TEST_SITE}/bienvenida`);

    const admin = cliente(t.secretKey);
    expect((await admin.from("profiles").select("nombre")).data).toEqual([{ nombre: "Ana" }]);
  });

  it("sin confirmar no entra: «Email not confirmed»", async () => {
    const { error } = await cliente().auth.signInWithPassword({ email: "ana@correo.mx", password: "secreto-1" });
    expect(error).toMatchObject({ status: 400, code: "email_not_confirmed", message: "Email not confirmed" });
  });

  it("🔴 el enlace del correo confirma y vuelve a la página con la sesión en el fragmento", async () => {
    const r = await abrir(enlace("ana@correo.mx", "signup"));
    expect(r.status).toBe(303);
    expect(r.location.startsWith(`${TEST_SITE}/bienvenida#`)).toBe(true);
    expect(r.fragment.get("type")).toBe("signup");
    expect(r.fragment.get("token_type")).toBe("bearer");
    expect(r.fragment.get("expires_in")).toBe("3600");
    expect(r.fragment.get("access_token")).toBeTruthy();
    expect(r.fragment.get("refresh_token")).toBeTruthy();

    // La página hace lo que hace supabase-js con ese fragmento.
    const supa = cliente();
    const { data, error } = await supa.auth.setSession({
      access_token: r.fragment.get("access_token")!,
      refresh_token: r.fragment.get("refresh_token")!,
    });
    expect(error).toBeNull();
    expect(data.user).toMatchObject({ email: "ana@correo.mx", user_metadata: { nombre: "Ana", email_verified: true } });
    expect(data.user!.email_confirmed_at).toBeTruthy();
  });

  it("el enlace es de un uso: la segunda vez vuelve con el error de GoTrue", async () => {
    const r = await abrir(enlace("ana@correo.mx", "signup"));
    expect(r.status).toBe(303);
    expect(r.location.startsWith(`${TEST_SITE}/bienvenida#`)).toBe(true);
    expect(Object.fromEntries(r.fragment)).toEqual({
      error: "access_denied",
      error_code: "otp_expired",
      error_description: "Email link is invalid or has expired",
      sb: "",
    });
  });

  it("un correo ya registrado y confirmado: responde como si nada (sin identidades) y no manda correo", async () => {
    const antes = t.mails.length;
    const { data, error } = await cliente().auth.signUp({ email: "ana@correo.mx", password: "otro-secreto" });
    expect(error).toBeNull();
    expect(data.user!.identities).toEqual([]);
    expect(t.mails.length).toBe(antes);
  });

  it("contraseña corta: AuthWeakPasswordError con sus razones", async () => {
    const { error } = await cliente().auth.signUp({ email: "bea@correo.mx", password: "123" });
    expect(error).toMatchObject({ status: 422, code: "weak_password", message: "Password should be at least 6 characters." });
    expect((error as unknown as { reasons: string[] }).reasons).toEqual(["length"]);
  });

  it("un correo que no lo parece", async () => {
    const { error } = await cliente().auth.signUp({ email: "no-es-correo", password: "secreto-1" });
    expect(error).toMatchObject({ status: 400, code: "validation_failed" });
    expect(error!.message).toMatch(/^Unable to validate email address/);
  });

  it("un enlace inventado: el error de GoTrue en el fragmento, a la página", async () => {
    const r = await abrir(`${TEST_URL}/auth/v1/verify?token=x&type=signup&redirect_to=${encodeURIComponent(TEST_SITE)}`);
    expect(r.location.startsWith(`${TEST_SITE}#`)).toBe(true);
    expect(r.fragment.get("error_code")).toBe("otp_expired");
  });

  it("BRAZO DE CONTROL: un redirect_to de otro sitio no se sigue: vuelve a la página del proyecto", async () => {
    const r = await abrir(`${TEST_URL}/auth/v1/verify?token=x&type=signup&redirect_to=${encodeURIComponent("https://malo.example/robar")}`);
    expect(r.location.startsWith(`${TEST_SITE}#`)).toBe(true);
  });
});

describe("entrar, la sesión y RLS con auth.uid()", () => {
  let ana: SupabaseClient;

  it("🔴 signInWithPassword: sesión con los claims de GoTrue", async () => {
    ana = cliente();
    const { data, error } = await ana.auth.signInWithPassword({ email: "ana@correo.mx", password: "secreto-1" });
    expect(error).toBeNull();
    expect(data.session).toMatchObject({ token_type: "bearer", expires_in: 3600 });
    const claims = JSON.parse(Buffer.from(data.session!.access_token.split(".")[1]!, "base64url").toString());
    expect(claims).toMatchObject({
      sub: data.user!.id,
      aud: "authenticated",
      role: "authenticated",
      email: "ana@correo.mx",
      aal: "aal1",
      is_anonymous: false,
      app_metadata: { provider: "email", providers: ["email"] },
    });
    expect(claims.amr).toEqual([{ method: "password", timestamp: expect.any(Number) }]);
    expect(claims.session_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("contraseña mala: «Invalid login credentials»", async () => {
    const { error } = await cliente().auth.signInWithPassword({ email: "ana@correo.mx", password: "no-es" });
    expect(error).toMatchObject({ status: 400, code: "invalid_credentials", message: "Invalid login credentials" });
  });

  it("🔴 getUser y getClaims con la sesión", async () => {
    expect((await ana.auth.getUser()).data.user).toMatchObject({ email: "ana@correo.mx" });
    const { data, error } = await ana.auth.getClaims();
    expect(error).toBeNull();
    expect(data!.claims).toMatchObject({ email: "ana@correo.mx", role: "authenticated" });
  });

  it("🔴 RLS: cada quien sus notas, con user_id = auth.uid() por defecto", async () => {
    await cliente(t.secretKey).auth.admin.createUser({ email: "bea@correo.mx", password: "secreto-2", email_confirm: true });
    const bea = cliente();
    expect((await bea.auth.signInWithPassword({ email: "bea@correo.mx", password: "secreto-2" })).error).toBeNull();

    expect((await ana.from("notas").insert({ texto: "de Ana" })).error).toBeNull();
    expect((await bea.from("notas").insert({ texto: "de Bea" })).error).toBeNull();
    expect((await ana.from("notas").select("texto")).data).toEqual([{ texto: "de Ana" }]);
    expect((await bea.from("notas").select("texto")).data).toEqual([{ texto: "de Bea" }]);
    // Sin sesión, nada.
    expect((await cliente().from("notas").select("texto")).data).toEqual([]);
    // Y Ana no escribe a nombre de Bea.
    const beaId = (await bea.auth.getUser()).data.user!.id;
    const r = await ana.from("notas").insert({ texto: "suplantada", user_id: beaId });
    expect(r.error).toMatchObject({ code: "42501" });
    expect(r.status).toBe(403);
  });

  it("refreshSession: tokens nuevos, y el viejo ya no se reutiliza fuera del intervalo… salvo dentro de él", async () => {
    const antes = (await ana.auth.getSession()).data.session!;
    const { data, error } = await ana.auth.refreshSession();
    expect(error).toBeNull();
    expect(data.session!.refresh_token).not.toBe(antes.refresh_token);
    expect((await ana.auth.getUser()).data.user!.email).toBe("ana@correo.mx");
  });

  it("🔴 signOut: el refresh token muere y la sesión ya no existe", async () => {
    const s = (await ana.auth.getSession()).data.session!;
    expect((await ana.auth.signOut()).error).toBeNull();
    const otro = cliente();
    const r = await otro.auth.refreshSession({ refresh_token: s.refresh_token });
    expect(r.error).toMatchObject({ status: 400 });
    const res = await handleBackendRequest(
      new Request(`${TEST_URL}/auth/v1/user`, { headers: { apikey: t.project.publishableKey, authorization: `Bearer ${s.access_token}` } }),
      t.project,
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 403, error_code: "session_not_found" });
  });

  it("BRAZO DE CONTROL: un JWT firmado con otro secreto no abre /user", async () => {
    const falso = await signJwt(newJwtSecret(), { sub: "11111111-1111-1111-1111-111111111111", role: "authenticated", session_id: "x" }, 3600);
    const res = await handleBackendRequest(
      new Request(`${TEST_URL}/auth/v1/user`, { headers: { apikey: t.project.publishableKey, authorization: `Bearer ${falso}` } }),
      t.project,
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error_code: "bad_jwt" });
  });
});

describe("recuperar la contraseña", () => {
  it("🔴 el enlace deja dentro con type=recovery, y updateUser pone la nueva", async () => {
    const supa = cliente();
    expect((await supa.auth.resetPasswordForEmail("ana@correo.mx", { redirectTo: `${TEST_SITE}/nueva` })).error).toBeNull();
    const r = await abrir(enlace("ana@correo.mx", "recovery"));
    expect(r.location.startsWith(`${TEST_SITE}/nueva#`)).toBe(true);
    expect(r.fragment.get("type")).toBe("recovery");

    await supa.auth.setSession({ access_token: r.fragment.get("access_token")!, refresh_token: r.fragment.get("refresh_token")! });
    expect((await supa.auth.updateUser({ password: "nueva-clave-1" })).error).toBeNull();

    expect((await cliente().auth.signInWithPassword({ email: "ana@correo.mx", password: "secreto-1" })).error).toMatchObject({
      code: "invalid_credentials",
    });
    expect((await cliente().auth.signInWithPassword({ email: "ana@correo.mx", password: "nueva-clave-1" })).error).toBeNull();
  });

  it("un correo sin cuenta: responde igual y no manda nada", async () => {
    const antes = t.mails.length;
    expect((await cliente().auth.resetPasswordForEmail("nadie@correo.mx")).error).toBeNull();
    expect(t.mails.length).toBe(antes);
  });

  it("dos seguidos: el límite de frecuencia de GoTrue", async () => {
    await cliente(t.secretKey).auth.admin.createUser({ email: "cata@correo.mx", password: "secreto-3", email_confirm: true });
    expect((await cliente().auth.resetPasswordForEmail("cata@correo.mx")).error).toBeNull();
    const { error } = await cliente().auth.resetPasswordForEmail("cata@correo.mx");
    expect(error).toMatchObject({ status: 429, code: "over_email_send_rate_limit" });
    expect(error!.message).toMatch(/^For security purposes, you can only request this after \d+ seconds\.$/);
  });
});

describe("invitar (con la clave secreta)", () => {
  it("🔴 inviteUserByEmail → el invitado abre el enlace, queda dentro y pone su contraseña", async () => {
    const admin = cliente(t.secretKey);
    const { data, error } = await admin.auth.admin.inviteUserByEmail("dani@correo.mx", {
      data: { nombre: "Dani" },
      redirectTo: `${TEST_SITE}/caja`,
    });
    expect(error).toBeNull();
    expect(data.user).toMatchObject({ email: "dani@correo.mx" });
    expect(data.user!.invited_at).toBeTruthy();

    const r = await abrir(enlace("dani@correo.mx", "invite"));
    expect(r.location.startsWith(`${TEST_SITE}/caja#`)).toBe(true);
    expect(r.fragment.get("type")).toBe("invite");

    const dani = cliente();
    await dani.auth.setSession({ access_token: r.fragment.get("access_token")!, refresh_token: r.fragment.get("refresh_token")! });
    expect((await dani.auth.updateUser({ password: "la-de-dani" })).error).toBeNull();
    expect((await cliente().auth.signInWithPassword({ email: "dani@correo.mx", password: "la-de-dani" })).error).toBeNull();
  });

  it("BRAZO DE CONTROL: con la clave publicable no se invita", async () => {
    const { error } = await cliente().auth.admin.inviteUserByEmail("eva@correo.mx");
    expect(error).toMatchObject({ status: 403, code: "not_admin" });
  });
});

describe("lo demás", () => {
  it("settings", async () => {
    const res = await handleBackendRequest(new Request(`${TEST_URL}/auth/v1/settings`, { headers: { apikey: t.project.publishableKey } }), t.project);
    expect(await res.json()).toMatchObject({ external: { email: true }, disable_signup: false, mailer_autoconfirm: false });
  });

  it("listar usuarios con la clave secreta", async () => {
    const { data, error } = await cliente(t.secretKey).auth.admin.listUsers();
    expect(error).toBeNull();
    expect(data.users.map((u) => u.email).sort()).toEqual(["ana@correo.mx", "bea@correo.mx", "cata@correo.mx", "dani@correo.mx"]);
  });
});
