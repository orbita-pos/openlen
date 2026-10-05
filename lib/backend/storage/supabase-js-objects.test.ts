// @vitest-environment node
//
// Subir y bajar ficheros contra la LIBRERÍA REAL (`supabase.storage` de
// @supabase/supabase-js 2.117.2), con las políticas de la documentación de
// Supabase («Storage Access Control»).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { signJwt } from "../keys";
import { handleBackendRequest, type BackendProject } from "../router";
import { TEST_REF, TEST_URL, type TestProject } from "../testing/project";
import { MemoryBlobStore } from "./blob-store";
import { newStorageTestProject } from "./testing";

// Montar el esquema real (GoTrue + las 73 de storage) en PGlite tarda; en paralelo, más que los 5 s de serie.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

const MIGRACION = `
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true);
create policy "avatar: subir a tu carpeta" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "avatar: cambiar lo tuyo" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and owner_id = (select auth.uid()::text));
create policy "avatar: ver lo tuyo" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and owner_id = (select auth.uid()::text));

insert into storage.buckets (id, name, public) values ('privado', 'privado', false);
create policy "privado: subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'privado' and owner_id = (select auth.uid()::text));
create policy "privado: ver lo tuyo" on storage.objects for select to authenticated
  using (bucket_id = 'privado' and owner_id = (select auth.uid()::text));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('pequeno', 'pequeno', false, 1000, '{"image/*","text/plain"}');
create policy "pequeno: subir" on storage.objects for insert to authenticated with check (bucket_id = 'pequeno');
`;

let t: TestProject;
let project: BackendProject;
const store = new MemoryBlobStore();
const fetchDe = (p: () => BackendProject) => (i: RequestInfo | URL, init?: RequestInit) => handleBackendRequest(new Request(i, init), p());

async function comoUsuario(sub: string, p: () => BackendProject = () => project): Promise<SupabaseClient> {
  const jwt = await signJwt(t.project.jwtSecret, { sub, role: "authenticated", aud: "authenticated" }, 3600);
  return createClient(TEST_URL, t.project.publishableKey, { global: { fetch: fetchDe(p) }, accessToken: async () => jwt });
}
const admin = () => createClient(TEST_URL, t.secretKey, { global: { fetch: fetchDe(() => project) }, auth: { persistSession: false } });
const png = (n: number, b = 7) => new Blob([new Uint8Array(n).fill(b)], { type: "image/png" });
const filas = async (bucket: string) =>
  (await t.pg.query<{ name: string; version: string; owner_id: string }>(`select name, version, owner_id from storage.objects where bucket_id = $1 order by name`, [bucket])).rows;
const blobsDe = (bucket: string, name: string) => store.keys().filter((k) => k.startsWith(`${TEST_REF}/${bucket}/${name}/`));

beforeAll(async () => {
  t = await newStorageTestProject(MIGRACION);
  project = { ...t.project, storage: { store } };
});

describe("supabase.storage — subir", () => {
  it("un usuario sube a su carpeta: la respuesta de Supabase, una fila suya y un blob", async () => {
    const u1 = await comoUsuario(U1);
    const { data, error } = await u1.storage.from("avatars").upload(`${U1}/a.png`, png(10));
    expect(error).toBeNull();
    expect(data).toEqual({ path: `${U1}/a.png`, fullPath: `avatars/${U1}/a.png`, id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(await filas("avatars")).toEqual([{ name: `${U1}/a.png`, version: expect.any(String), owner_id: U1 }]);
    expect(blobsDe("avatars", `${U1}/a.png`)).toHaveLength(1);
  });

  it("a la carpeta de otro: 403 de RLS y NINGÚN blob nuevo", async () => {
    const antes = store.keys();
    const { error } = await (await comoUsuario(U1)).storage.from("avatars").upload(`${U2}/a.png`, png(10));
    expect(error).toMatchObject({ statusCode: "403", message: "new row violates row-level security policy" });
    expect(store.keys()).toEqual(antes);
  });

  it("otra vez sin upsert: 409; con upsert: versión nueva y el blob viejo fuera", async () => {
    const u1 = await comoUsuario(U1);
    const otra = await u1.storage.from("avatars").upload(`${U1}/a.png`, png(10));
    expect(otra.error).toMatchObject({ statusCode: "409", message: "The resource already exists" });
    const [antes] = await filas("avatars");
    const { error } = await u1.storage.from("avatars").upload(`${U1}/a.png`, png(20, 9), { upsert: true });
    expect(error).toBeNull();
    const [despues] = await filas("avatars");
    expect(despues!.version).not.toBe(antes!.version);
    expect(blobsDe("avatars", `${U1}/a.png`)).toEqual([`${TEST_REF}/avatars/${U1}/a.png/${despues!.version}`]);
  });

  it("update() es un upsert (PUT)", async () => {
    const { error } = await (await comoUsuario(U1)).storage.from("avatars").update(`${U1}/a.png`, png(5, 3));
    expect(error).toBeNull();
    expect(blobsDe("avatars", `${U1}/a.png`)).toHaveLength(1);
  });

  it("un cuerpo crudo (no Blob) con su tipo y caché", async () => {
    const u1 = await comoUsuario(U1);
    const { error } = await u1.storage.from("privado").upload("u1/nota.txt", "hola mundo", { contentType: "text/plain", cacheControl: "60" });
    expect(error).toBeNull();
    const { data } = await u1.storage.from("privado").info("u1/nota.txt");
    expect(data).toMatchObject({ name: "u1/nota.txt", bucketId: "privado", size: 10, contentType: "text/plain", cacheControl: "max-age=60" });
  });

  it("dos upsert a la vez sobre la misma ruta: una fila y un solo blob", async () => {
    const u1 = await comoUsuario(U1);
    const r = await Promise.all([1, 2].map((b) => u1.storage.from("avatars").upload(`${U1}/doble.png`, png(8, b), { upsert: true })));
    expect(r.map((x) => x.error)).toEqual([null, null]);
    expect((await filas("avatars")).filter((f) => f.name === `${U1}/doble.png`)).toHaveLength(1);
    expect(blobsDe("avatars", `${U1}/doble.png`)).toHaveLength(1);
  });
});

describe("supabase.storage — límites (Review Focus 2)", () => {
  it("más que el límite del bucket: 413 y ni fila ni blob", async () => {
    const u1 = await comoUsuario(U1);
    const { error } = await u1.storage.from("pequeno").upload("grande.png", png(1001));
    expect(error).toMatchObject({ statusCode: "413", message: "The object exceeded the maximum allowed size" });
    expect(await filas("pequeno")).toEqual([]);
    expect(store.keys().filter((k) => k.includes("/pequeno/"))).toEqual([]);
  });

  it("lo mismo con un cuerpo en flujo y sin Content-Length", async () => {
    const u1 = await comoUsuario(U1);
    const flujo = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(600));
        c.enqueue(new Uint8Array(600));
        c.close();
      },
    });
    const { error } = await u1.storage.from("pequeno").upload("flujo.png", flujo, { contentType: "image/png", duplex: "half" });
    expect(error).toMatchObject({ statusCode: "413" });
    expect(await filas("pequeno")).toEqual([]);
    expect(store.keys().filter((k) => k.includes("/pequeno/"))).toEqual([]);
  });

  it("un cuerpo que se corta a mitad: error, ni fila ni blob", async () => {
    const u1 = await comoUsuario(U1);
    const roto = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(100));
        c.error(new Error("se cortó la conexión"));
      },
    });
    const { error } = await u1.storage.from("pequeno").upload("roto.png", roto, { contentType: "image/png", duplex: "half" });
    expect(error).not.toBeNull();
    expect(await filas("pequeno")).toEqual([]);
    expect(store.keys().filter((k) => k.includes("/pequeno/"))).toEqual([]);
  });

  it("un tipo que el bucket no admite: 415", async () => {
    const { error } = await (await comoUsuario(U1)).storage
      .from("pequeno")
      .upload("x.html", new Blob(["<p>"], { type: "text/html" }));
    expect(error).toMatchObject({ statusCode: "415", message: "mime type text/html is not supported" });
  });

  it("pasarse del tope del proyecto: 413", async () => {
    const corto: BackendProject = { ...project, storage: { store, limits: { fileSizeLimit: 1_000_000, projectLimit: 1 } } };
    const u1 = await comoUsuario(U1, () => corto);
    const { error } = await u1.storage.from("avatars").upload(`${U1}/tope.png`, png(10));
    expect(error).toMatchObject({ statusCode: "413", message: "The project exceeded its storage limit" });
    expect(blobsDe("avatars", `${U1}/tope.png`)).toEqual([]);
  });
});

describe("supabase.storage — bajar", () => {
  it("download de lo suyo en un bucket privado: los mismos bytes", async () => {
    const u1 = await comoUsuario(U1);
    await u1.storage.from("privado").upload("u1/b.bin", new Blob([new Uint8Array([1, 2, 3, 4])], { type: "application/octet-stream" }));
    const { data, error } = await u1.storage.from("privado").download("u1/b.bin");
    expect(error).toBeNull();
    expect([...new Uint8Array(await data!.arrayBuffer())]).toEqual([1, 2, 3, 4]);
  });

  it("lo de otro en un bucket privado: RLS lo esconde (Object not found)", async () => {
    const { data, error } = await (await comoUsuario(U2)).storage.from("privado").download("u1/b.bin");
    expect(data).toBeNull();
    expect(error).toMatchObject({ statusCode: "404", message: "Object not found" });
  });

  it("service_role lo ve todo", async () => {
    const { data } = await admin().storage.from("privado").download("u1/b.bin");
    expect(data?.size).toBe(4);
  });

  it("un bucket que no existe: Bucket not found", async () => {
    const { error } = await admin().storage.from("nada").download("x");
    expect(error).toMatchObject({ statusCode: "404", message: "Bucket not found" });
  });

  it("info() y exists()", async () => {
    const u1 = await comoUsuario(U1);
    const { data } = await u1.storage.from("privado").info("u1/b.bin");
    expect(data).toMatchObject({ name: "u1/b.bin", size: 4, contentType: "application/octet-stream", cacheControl: "max-age=3600" });
    expect((await u1.storage.from("privado").exists("u1/b.bin")).data).toBe(true);
    expect((await u1.storage.from("privado").exists("u1/no.bin")).data).toBe(false);
  });
});
