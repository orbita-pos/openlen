// @vitest-environment node
//
// Dos entornos del MISMO proyecto (spec local 2026-10-09), con la librería
// real: lo que se escribe en uno no se ve en el otro, y una sesión de uno no
// abre el otro (cada entorno firma con su propio secreto).
import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it } from "vitest";

import { handleBackendRequest, type BackendProject } from "./router";
import { newTestProject, TEST_URL, type TestProject } from "./testing/project";

const MIGRATION = `
create table public.productos (id bigint generated always as identity primary key, nombre text not null);
alter table public.productos enable row level security;
create policy "todos" on public.productos for all to anon, authenticated using (true) with check (true);
`;

let draft: BackendProject;
let live: TestProject;

beforeEach(async () => {
  const d = await newTestProject(MIGRATION);
  // El borrador confirma solas las cuentas nuevas (authConfigFor, environment "draft").
  draft = { ...d.project, environment: "draft", auth: { ...d.project.auth, config: { ...d.project.auth.config, mailerAutoconfirm: true } } };
  live = await newTestProject(MIGRATION);
});

const client = (p: BackendProject) =>
  createClient(TEST_URL, p.publishableKey, {
    global: { fetch: (input, init) => handleBackendRequest(new Request(input, init), p) },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

describe("borrador y producción del mismo proyecto", () => {
  it("un producto de prueba no aparece en producción", async () => {
    const { error } = await client(draft).from("productos").insert({ nombre: "Coca de prueba" });
    expect(error).toBeNull();
    const { data } = await client(live.project).from("productos").select("nombre");
    expect(data).toEqual([]);
  });

  it("una sesión del borrador no vale en producción", async () => {
    const { data, error } = await client(draft).auth.signUp({ email: "prueba@ejemplo.com", password: "una-clave-larga-1" });
    expect(error).toBeNull();
    const token = data.session?.access_token;
    expect(token).toBeTruthy();
    const res = await handleBackendRequest(
      new Request(`${TEST_URL}/rest/v1/productos`, { headers: { apikey: live.project.publishableKey, authorization: `Bearer ${token}` } }),
      live.project,
    );
    expect(res.status).toBe(401);
  });
});
