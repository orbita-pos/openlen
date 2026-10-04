// @vitest-environment node
//
// El panel del dueño (fase 6): lo que el editor de tablas y Authentication →
// Users de Supabase hacen, sobre la base del proyecto en PGlite. Las tablas van
// por nuestro /rest/v1 como `service_role` (salta RLS, como el editor de
// Supabase); los usuarios, por nuestro GoTrue.
import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it } from "vitest";

import {
  deleteAuthUser,
  deleteRow,
  insertRow,
  inviteUser,
  listAuthUsers,
  listTables,
  readRows,
  signOutUser,
  updateRow,
} from "./dashboard";
import { handleBackendRequest } from "./router";
import { newTestProject, TEST_URL, type TestProject } from "./testing/project";

const MIGRATION = `
create table public.notas (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  texto text not null
);
alter table public.notas enable row level security;
create policy "mis notas" on public.notas for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table public.productos (
  sku text primary key,
  nombre text not null,
  precio numeric(10,2) default 0
);

create table public.visitas_log (momento timestamptz default now(), ruta text);
create schema privado;
create table privado.secreto (id int primary key);
`;

let t: TestProject;

beforeEach(async () => {
  t = await newTestProject(MIGRATION);
});

const fetchFor = () => (input: RequestInfo | URL, init?: RequestInit) => handleBackendRequest(new Request(input, init), t.project);

async function createUser(email: string): Promise<string> {
  const admin = createClient(TEST_URL, t.secretKey, {
    global: { fetch: fetchFor() },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await admin.auth.admin.createUser({ email, password: "una-clave-larga-1", email_confirm: true });
  if (error || !data.user) throw error ?? new Error("sin usuario");
  return data.user.id;
}

/** Un cliente de la página que entra con correo y contraseña. */
async function signedIn(email: string) {
  const sb = createClient(TEST_URL, t.project.publishableKey, {
    global: { fetch: fetchFor() },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await sb.auth.signInWithPassword({ email, password: "una-clave-larga-1" });
  if (error) throw error;
  return sb;
}

describe("panel del dueño — tablas", () => {
  it("lista las tablas de public con su RLS, sus políticas, su clave y sus columnas; nada de otros esquemas", async () => {
    const tables = await listTables(t.project);
    expect(tables.map((x) => x.name)).toEqual(["notas", "productos", "visitas_log"]);
    const notas = tables.find((x) => x.name === "notas")!;
    expect(notas).toMatchObject({ rls: true, policies: 1, primaryKey: ["id"] });
    expect(notas.columns.map((c) => [c.name, c.type, c.nullable])).toEqual([
      ["id", "bigint", false],
      ["user_id", "uuid", false],
      ["texto", "text", false],
    ]);
    expect(notas.columns[0]).toMatchObject({ identity: "always", hasDefault: false });
    expect(notas.columns[1]).toMatchObject({ identity: null, hasDefault: true });
    expect(tables.find((x) => x.name === "productos")).toMatchObject({ rls: false, policies: 0, primaryKey: ["sku"] });
    expect(tables.find((x) => x.name === "productos")!.columns[2]!.type).toBe("numeric(10,2)");
    expect(tables.find((x) => x.name === "visitas_log")).toMatchObject({ primaryKey: [] });
  }, 30_000);

  it("🔴 lee las filas de TODOS los usuarios aunque RLS las separe, con el total y por páginas", async () => {
    await createUser("ana@tiendaluna.mx");
    await createUser("beto@tiendaluna.mx");
    const ana = await signedIn("ana@tiendaluna.mx");
    const beto = await signedIn("beto@tiendaluna.mx");
    await ana.from("notas").insert([{ texto: "a1" }, { texto: "a2" }]);
    await beto.from("notas").insert({ texto: "b1" });

    const all = await readRows(t.project, "notas", { offset: 0, limit: 10 });
    if ("error" in all) throw new Error(all.error);
    expect(all.total).toBe(3);
    expect(all.rows.map((r) => r.texto)).toEqual(["a1", "a2", "b1"]);
    const second = await readRows(t.project, "notas", { offset: 2, limit: 2 });
    if ("error" in second) throw new Error(second.error);
    expect(second.rows.map((r) => r.texto)).toEqual(["b1"]);
    expect(second.total).toBe(3);
  }, 30_000);

  it("🔴 agrega, cambia y borra por la clave, también con una clave de texto con comas y comillas", async () => {
    const sku = 'caja, "grande"';
    expect(await insertRow(t.project, "productos", { sku, nombre: "Caja", precio: "12.50" })).toMatchObject({ row: { sku, precio: 12.5 } });
    await insertRow(t.project, "productos", { sku: "otro", nombre: "Otro" });
    expect(await updateRow(t.project, "productos", { sku }, { nombre: "Caja grande" })).toMatchObject({ row: { nombre: "Caja grande" } });
    // Sólo cambió la suya.
    const rows = await readRows(t.project, "productos", { offset: 0, limit: 10 });
    if ("error" in rows) throw new Error(rows.error);
    expect(rows.rows.map((r) => r.nombre)).toEqual(["Caja grande", "Otro"]);
    expect(await deleteRow(t.project, "productos", { sku })).toEqual({ ok: true });
    const left = await readRows(t.project, "productos", { offset: 0, limit: 10 });
    if ("error" in left) throw new Error(left.error);
    expect(left.rows.map((r) => r.sku)).toEqual(["otro"]);
  }, 30_000);

  it("el error de Postgres llega con su mensaje", async () => {
    const r = await insertRow(t.project, "productos", { sku: "sin-nombre" });
    expect(r).toMatchObject({ error: expect.stringMatching(/null value in column "nombre"/) });
  }, 30_000);

  it("🔴 una tabla sin clave no se cambia ni se borra por fila", async () => {
    await insertRow(t.project, "visitas_log", { ruta: "/" });
    expect(await updateRow(t.project, "visitas_log", {}, { ruta: "/x" })).toMatchObject({ error: expect.stringMatching(/primary key/) });
    expect(await deleteRow(t.project, "visitas_log", {})).toMatchObject({ error: expect.stringMatching(/primary key/) });
    const rows = await readRows(t.project, "visitas_log", { offset: 0, limit: 10 });
    if ("error" in rows) throw new Error(rows.error);
    expect(rows.rows.map((r) => r.ruta)).toEqual(["/"]);
  }, 30_000);

  it("🔴 una clave incompleta no toca nada", async () => {
    await insertRow(t.project, "productos", { sku: "a", nombre: "A" });
    expect(await deleteRow(t.project, "productos", { nombre: "A" })).toMatchObject({ error: expect.stringMatching(/primary key/) });
    const rows = await readRows(t.project, "productos", { offset: 0, limit: 10 });
    if ("error" in rows) throw new Error(rows.error);
    expect(rows.total).toBe(1);
  }, 30_000);

  it("una tabla que no está en public no se lee", async () => {
    expect(await readRows(t.project, "secreto", { offset: 0, limit: 10 })).toMatchObject({ error: expect.any(String) });
    expect(await readRows(t.project, "privado.secreto", { offset: 0, limit: 10 })).toMatchObject({ error: expect.any(String) });
  }, 30_000);
});

describe("panel del dueño — usuarios", () => {
  it("lista los usuarios con su estado", async () => {
    await createUser("ana@tiendaluna.mx");
    await signedIn("ana@tiendaluna.mx");
    const { users, total } = await listAuthUsers(t.project, 1);
    expect(total).toBe(1);
    expect(users[0]).toMatchObject({ email: "ana@tiendaluna.mx", confirmed: true, invited: false });
    expect(users[0]!.lastSignInAt).not.toBeNull();
  }, 30_000);

  it("🔴 invitar manda el correo y lo deja como invitado", async () => {
    expect(await inviteUser(t.project, "caro@tiendaluna.mx")).toEqual({ ok: true });
    expect(t.mails.map((m) => [m.to, m.kind])).toEqual([["caro@tiendaluna.mx", "invite"]]);
    const { users } = await listAuthUsers(t.project, 1);
    expect(users[0]).toMatchObject({ email: "caro@tiendaluna.mx", confirmed: false, invited: true });
  }, 30_000);

  it("invitar a quien ya está confirmado lo dice", async () => {
    await createUser("ana@tiendaluna.mx");
    expect(await inviteUser(t.project, "ana@tiendaluna.mx")).toMatchObject({ error: expect.stringMatching(/already been registered/) });
  }, 30_000);

  it("🔴 cerrar sesiones deja su token sin valer, y borrar lo quita", async () => {
    const ana = await createUser("ana@tiendaluna.mx");
    const sb = await signedIn("ana@tiendaluna.mx");
    expect((await sb.auth.getUser()).error).toBeNull();
    expect(await signOutUser(t.project, ana)).toEqual({ ok: true });
    expect((await sb.auth.getUser()).error).not.toBeNull();
    expect(await deleteAuthUser(t.project, ana)).toEqual({ ok: true });
    expect((await listAuthUsers(t.project, 1)).total).toBe(0);
  }, 30_000);
});
