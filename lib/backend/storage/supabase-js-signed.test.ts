// @vitest-environment node
//
// URLs firmadas de bajada y de subida contra la LIBRERÍA REAL.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { signJwt } from "../keys";
import { handleBackendRequest, type BackendProject } from "../router";
import { TEST_URL, type TestProject } from "../testing/project";
import { MemoryBlobStore } from "./blob-store";
import { newStorageTestProject } from "./testing";

// Montar el esquema real (GoTrue + las 73 de storage) en PGlite tarda; en paralelo, más que los 5 s de serie.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

const MIGRACION = `
insert into storage.buckets (id, name) values ('privado', 'privado');
create policy "ver lo tuyo" on storage.objects for select to authenticated
  using (bucket_id = 'privado' and owner_id = (select auth.uid()::text));
create policy "subir lo tuyo" on storage.objects for insert to authenticated
  with check (bucket_id = 'privado' and (storage.foldername(name))[1] = (select auth.uid()::text));
`;

let t: TestProject;
let project: BackendProject;
const store = new MemoryBlobStore();
const fetchDe = (i: RequestInfo | URL, init?: RequestInit) => handleBackendRequest(new Request(i, init), project);
async function como(sub: string): Promise<SupabaseClient> {
  const jwt = await signJwt(t.project.jwtSecret, { sub, role: "authenticated", aud: "authenticated" }, 3600);
  return createClient(TEST_URL, t.project.publishableKey, { global: { fetch: fetchDe }, accessToken: async () => jwt });
}
let u1: SupabaseClient;
let u2: SupabaseClient;
beforeAll(async () => {
  t = await newStorageTestProject(MIGRACION);
  project = { ...t.project, storage: { store } };
  u1 = await como(U1);
  u2 = await como(U2);
  await u1.storage.from("privado").upload(`${U1}/foto de perfil.png`, new Blob([new Uint8Array([4, 2])], { type: "image/png" }));
});

describe("createSignedUrl", () => {
  it("la URL firmada baja los bytes SIN sesión ni clave", async () => {
    const { data, error } = await u1.storage.from("privado").createSignedUrl(`${U1}/foto de perfil.png`, 60);
    expect(error).toBeNull();
    expect(data!.signedUrl).toContain(`${TEST_URL}/storage/v1/object/sign/privado/`);
    const r = await fetchDe(data!.signedUrl);
    expect(r.status).toBe(200);
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([4, 2]);
    expect(r.headers.get("cache-control")).toMatch(/^private/);
  });

  it("de algo que RLS esconde: Object not found, y no se firma nada", async () => {
    const { data, error } = await u2.storage.from("privado").createSignedUrl(`${U1}/foto de perfil.png`, 60);
    expect(data).toBeNull();
    expect(error).toMatchObject({ statusCode: "404", message: "Object not found" });
  });

  it("un token de otra ruta no vale", async () => {
    const { data } = await u1.storage.from("privado").createSignedUrl(`${U1}/foto de perfil.png`, 60);
    const token = new URL(data!.signedUrl).searchParams.get("token");
    const r = await fetchDe(`${TEST_URL}/storage/v1/object/sign/privado/${U1}/otra.png?token=${token}`);
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ statusCode: "400", message: "Invalid signature" });
  });

  it("un token manipulado: InvalidJWT", async () => {
    const { data } = await u1.storage.from("privado").createSignedUrl(`${U1}/foto de perfil.png`, 60);
    const r = await fetchDe(`${data!.signedUrl.slice(0, -3)}abc`);
    expect(await r.json()).toMatchObject({ statusCode: "400", code: "InvalidJWT" });
  });

  it("un token de sesión no sirve como URL firmada (no tiene scope de bajada)", async () => {
    const sesion = await signJwt(t.project.jwtSecret, { sub: U1, role: "authenticated", upsert: true }, 3600);
    const r = await fetchDe(`${TEST_URL}/storage/v1/object/sign/privado/${U1}/foto%20de%20perfil.png?token=${sesion}`);
    expect(await r.json()).toMatchObject({ statusCode: "400", message: "Token is not scoped for download" });
  });

  it("expiresIn que no es un número válido: InvalidParameter", async () => {
    const { error } = await u1.storage.from("privado").createSignedUrl(`${U1}/foto de perfil.png`, 0);
    expect(error).toMatchObject({ statusCode: "400", message: "Invalid Parameter expiresIn" });
  });

  it("createSignedUrls: las que puede y un error por las que no", async () => {
    const { data } = await u1.storage.from("privado").createSignedUrls([`${U1}/foto de perfil.png`, `${U1}/no.png`], 60);
    expect(data?.[0]).toMatchObject({ path: `${U1}/foto de perfil.png`, error: null, signedUrl: expect.stringContaining("token=") });
    expect(data?.[1]).toMatchObject({ path: `${U1}/no.png`, error: "Either the object does not exist or you do not have access to it", signedUrl: null });
  });
});

describe("createSignedUploadUrl + uploadToSignedUrl", () => {
  it("quien firma decide; quien sube no necesita sesión, y el dueño es el que firmó", async () => {
    const { data, error } = await u1.storage.from("privado").createSignedUploadUrl(`${U1}/subida.png`);
    expect(error).toBeNull();
    const anon = createClient(TEST_URL, t.project.publishableKey, { global: { fetch: fetchDe }, auth: { persistSession: false } });
    const up = await anon.storage.from("privado").uploadToSignedUrl(`${U1}/subida.png`, data!.token, new Blob([new Uint8Array([7])], { type: "image/png" }));
    expect(up.error).toBeNull();
    expect(up.data).toMatchObject({ path: `${U1}/subida.png`, fullPath: `privado/${U1}/subida.png` });
    const fila = await t.pg.query<{ owner_id: string }>(`select owner_id from storage.objects where name = $1`, [`${U1}/subida.png`]);
    expect(fila.rows).toEqual([{ owner_id: U1 }]);
  });

  it("firmar donde RLS no deja subir: 403", async () => {
    const { error } = await u1.storage.from("privado").createSignedUploadUrl(`${U2}/x.png`);
    expect(error).toMatchObject({ statusCode: "403" });
  });

  it("un token de subida no baja nada", async () => {
    const { data } = await u1.storage.from("privado").createSignedUploadUrl(`${U1}/otra-subida.png`);
    const r = await fetchDe(`${TEST_URL}/storage/v1/object/sign/privado/${U1}/otra-subida.png?token=${data!.token}`);
    expect(await r.json()).toMatchObject({ message: "Token is not scoped for download" });
  });
});
