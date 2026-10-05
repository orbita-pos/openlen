// @vitest-environment node
//
// Listar, borrar, mover y copiar contra la LIBRERÍA REAL, con RLS.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { signJwt } from "../keys";
import { handleBackendRequest, type BackendProject } from "../router";
import { TEST_REF, TEST_URL, type TestProject } from "../testing/project";
import { MemoryBlobStore } from "./blob-store";
import { newStorageTestProject } from "./testing";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

// Cada uno lo suyo, en su carpeta: el patrón de la documentación de Supabase.
const MIGRACION = `
insert into storage.buckets (id, name) values ('docs', 'docs');
create policy "docs: ver lo tuyo" on storage.objects for select to authenticated
  using (bucket_id = 'docs' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "docs: subir a lo tuyo" on storage.objects for insert to authenticated
  with check (bucket_id = 'docs' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "docs: cambiar lo tuyo" on storage.objects for update to authenticated
  using (bucket_id = 'docs' and (storage.foldername(name))[1] = (select auth.uid()::text))
  with check (bucket_id = 'docs' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "docs: borrar lo tuyo" on storage.objects for delete to authenticated
  using (bucket_id = 'docs' and (storage.foldername(name))[1] = (select auth.uid()::text));
`;

let t: TestProject;
let project: BackendProject;
const store = new MemoryBlobStore();
async function como(sub: string): Promise<SupabaseClient> {
  const jwt = await signJwt(t.project.jwtSecret, { sub, role: "authenticated", aud: "authenticated" }, 3600);
  return createClient(TEST_URL, t.project.publishableKey, {
    global: { fetch: (i, init) => handleBackendRequest(new Request(i, init), project) },
    accessToken: async () => jwt,
  });
}
const txt = (s: string) => new Blob([s], { type: "text/plain" });
const nombres = async () => (await t.pg.query<{ name: string }>(`select name from storage.objects order by name`)).rows.map((r) => r.name);
const blobs = (name: string) => store.keys().filter((k) => k.startsWith(`${TEST_REF}/docs/${name}/`));

let u1: SupabaseClient;
let u2: SupabaseClient;
beforeAll(async () => {
  t = await newStorageTestProject(MIGRACION);
  project = { ...t.project, storage: { store } };
  u1 = await como(U1);
  u2 = await como(U2);
  await u1.storage.from("docs").upload(`${U1}/a.txt`, txt("a"));
  await u1.storage.from("docs").upload(`${U1}/sub/b.txt`, txt("bb"));
  await u2.storage.from("docs").upload(`${U2}/c.txt`, txt("ccc"));
});

describe("list", () => {
  it("lo de una carpeta, con sus metadatos; las subcarpetas con id null", async () => {
    const { data, error } = await u1.storage.from("docs").list(U1);
    expect(error).toBeNull();
    expect(data?.map((f) => ({ name: f.name, id: f.id === null ? null : "uuid" }))).toEqual([
      { name: "a.txt", id: "uuid" },
      { name: "sub", id: null },
    ]);
    expect(data?.[0]?.metadata).toMatchObject({ size: 1, mimetype: "text/plain" });
  });

  it("RLS: la raíz sólo enseña la carpeta propia", async () => {
    const { data } = await u1.storage.from("docs").list();
    expect(data?.map((f) => f.name)).toEqual([U1]);
  });

  it("search, orden y página", async () => {
    const { data } = await u1.storage.from("docs").list(U1, { search: "a", limit: 10, sortBy: { column: "name", order: "desc" } });
    expect(data?.map((f) => f.name)).toEqual(["a.txt"]);
  });
});

describe("remove", () => {
  it("sólo se borra lo que RLS deja, y su blob con ello", async () => {
    await u1.storage.from("docs").upload(`${U1}/borrar.txt`, txt("x"));
    const { data, error } = await u1.storage.from("docs").remove([`${U1}/borrar.txt`, `${U2}/c.txt`]);
    expect(error).toBeNull();
    expect(data?.map((f) => f.name)).toEqual([`${U1}/borrar.txt`]);
    expect(await nombres()).toContain(`${U2}/c.txt`);
    expect(blobs(`${U1}/borrar.txt`)).toEqual([]);
    expect(blobs(`${U2}/c.txt`)).toHaveLength(1);
  });

  it("más de 1000 de una vez: no", async () => {
    const { error } = await u1.storage.from("docs").remove(Array.from({ length: 1001 }, (_, i) => `${U1}/${i}`));
    expect(error).toMatchObject({ statusCode: "400" });
  });
});

describe("move y copy", () => {
  it("move dentro de lo suyo: la fila cambia de nombre y el blob de clave", async () => {
    const { data, error } = await u1.storage.from("docs").move(`${U1}/a.txt`, `${U1}/movido.txt`);
    expect(error).toBeNull();
    expect(data).toMatchObject({ message: "Successfully moved", Key: `${U1}/movido.txt` });
    expect(await nombres()).not.toContain(`${U1}/a.txt`);
    expect(blobs(`${U1}/a.txt`)).toEqual([]);
    expect(blobs(`${U1}/movido.txt`)).toHaveLength(1);
    const { data: bajado } = await u1.storage.from("docs").download(`${U1}/movido.txt`);
    expect(await bajado!.text()).toBe("a");
  });

  it("move a la carpeta de otro: RLS no deja, y no se toca nada", async () => {
    const antes = store.keys();
    const { error } = await u1.storage.from("docs").move(`${U1}/movido.txt`, `${U2}/robado.txt`);
    expect(error).toMatchObject({ statusCode: "403" });
    expect(store.keys()).toEqual(antes);
    expect(await nombres()).toContain(`${U1}/movido.txt`);
  });

  it("copy: una copia con sus bytes; el original sigue", async () => {
    const { data, error } = await u1.storage.from("docs").copy(`${U1}/movido.txt`, `${U1}/copia.txt`);
    expect(error).toBeNull();
    expect(data).toEqual({ path: `docs/${U1}/copia.txt` });
    expect(await (await u1.storage.from("docs").download(`${U1}/copia.txt`)).data!.text()).toBe("a");
    expect(blobs(`${U1}/movido.txt`)).toHaveLength(1);
  });

  it("copy de lo que RLS esconde: Object not found", async () => {
    const { error } = await u1.storage.from("docs").copy(`${U2}/c.txt`, `${U1}/c.txt`);
    expect(error).toMatchObject({ statusCode: "404", message: "Object not found" });
  });
});
