// @vitest-environment node
//
// Buckets contra la LIBRERÍA REAL: `supabase.storage` de @supabase/supabase-js
// 2.117.2 con su `fetch` apuntado a nuestro manejador, y la base en PGlite.
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { handleBackendRequest, type BackendProject } from "../router";
import { TEST_URL, type TestProject } from "../testing/project";
import { MemoryBlobStore } from "./blob-store";
import { newStorageTestProject } from "./testing";

// Montar el esquema real (GoTrue + las 73 de storage) en PGlite tarda; en paralelo, más que los 5 s de serie.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

// Lo que Len escribiría: un bucket que cualquiera puede ver (la política de la
// documentación de Supabase para listar buckets).
const MIGRACION = `
create policy "ver buckets" on storage.buckets for select to anon, authenticated using (true);
`;

let t: TestProject;
let project: BackendProject;
const store = new MemoryBlobStore();
const cliente = (key: string) =>
  createClient(TEST_URL, key, {
    global: { fetch: (i, init) => handleBackendRequest(new Request(i, init), project) },
    auth: { persistSession: false, autoRefreshToken: false },
  });
beforeAll(async () => {
  t = await newStorageTestProject(MIGRACION);
  project = { ...t.project, storage: { store } };
});

describe("supabase.storage — buckets", () => {
  it("con la clave secreta: crear, leer, listar, cambiar, vaciar y borrar", async () => {
    const admin = cliente(t.secretKey);
    expect(await admin.storage.createBucket("fotos", { public: true, fileSizeLimit: "1MB", allowedMimeTypes: ["image/*"] })).toEqual({
      data: { name: "fotos" },
      error: null,
    });
    const { data: b, error } = await admin.storage.getBucket("fotos");
    expect(error).toBeNull();
    expect(b).toMatchObject({ id: "fotos", name: "fotos", public: true, file_size_limit: 1_000_000, allowed_mime_types: ["image/*"], owner: null });
    expect(typeof b!.created_at).toBe("string");
    const { data: lista } = await admin.storage.listBuckets();
    expect(lista?.map((x) => x.id)).toEqual(["fotos"]);
    expect(await admin.storage.updateBucket("fotos", { public: false })).toEqual({ data: { message: "Successfully updated" }, error: null });
    expect((await admin.storage.getBucket("fotos")).data?.public).toBe(false);
    expect((await admin.storage.emptyBucket("fotos")).data).toEqual({ message: "Empty bucket has been queued. Completion may take up to an hour." });
    expect((await admin.storage.deleteBucket("fotos")).data).toEqual({ message: "Successfully deleted" });
    expect((await admin.storage.getBucket("fotos")).error).toMatchObject({ statusCode: "404", message: "Bucket not found" });
  });

  it("con la clave publicable y sin política de insert: RLS no deja crear", async () => {
    const { error } = await cliente(t.project.publishableKey).storage.createBucket("intruso");
    expect(error).toMatchObject({ name: "StorageApiError", status: 400, statusCode: "403", message: "new row violates row-level security policy" });
  });

  it("vaciar es sólo de service_role, como en Supabase", async () => {
    await cliente(t.secretKey).storage.createBucket("caja");
    const { error } = await cliente(t.project.publishableKey).storage.emptyBucket("caja");
    expect(error).toMatchObject({ status: 403, statusCode: "403", message: "Access denied: Invalid role" });
  });

  it("repetido: 409 de Supabase", async () => {
    const admin = cliente(t.secretKey);
    await admin.storage.createBucket("doble");
    const { error } = await admin.storage.createBucket("doble");
    expect(error).toMatchObject({ statusCode: "409", message: "The resource already exists" });
  });

  it("un nombre con espacios al borde o con barra: Bucket name invalid", async () => {
    const admin = cliente(t.secretKey);
    expect((await admin.storage.createBucket(" malo")).error).toMatchObject({ statusCode: "400", message: "Bucket name invalid" });
    expect((await admin.storage.createBucket("a/b")).error).toMatchObject({ statusCode: "400", message: "Bucket name invalid" });
  });

  it("un límite por fichero mayor que el del servidor: EntityTooLarge", async () => {
    const { error } = await cliente(t.secretKey).storage.createBucket("enorme", { public: false, fileSizeLimit: "10GB" });
    expect(error).toMatchObject({ statusCode: "413", message: "The object exceeded the maximum allowed size" });
  });

  it("listBuckets con búsqueda, orden y página", async () => {
    const admin = cliente(t.secretKey);
    await admin.storage.createBucket("zeta");
    const { data } = await admin.storage.listBuckets({ search: "e", sortColumn: "name", sortOrder: "desc", limit: 2 });
    expect(data?.map((x) => x.name)).toEqual(["zeta", "doble"]);
  });

  it("borrar un bucket con ficheros: no está vacío", async () => {
    await t.pg.query(`set role supabase_storage_admin`);
    await t.pg.query(`insert into storage.objects (bucket_id, name, version) values ('caja', 'x.txt', 'v1')`);
    await t.pg.query(`reset role`);
    const { error } = await cliente(t.secretKey).storage.deleteBucket("caja");
    expect(error).toMatchObject({ statusCode: "409", message: "The bucket you tried to delete is not empty" });
  });
});
