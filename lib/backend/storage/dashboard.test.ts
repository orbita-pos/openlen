// @vitest-environment node
//
// El panel del dueño, pestaña Storage: lo que enseña el navegador de ficheros
// de Supabase. Como el editor de tablas, el dueño lo ve TODO (service_role).
import { beforeAll, describe, expect, it, vi } from "vitest";

import { verifyJwt } from "../keys";
import type { BackendProject } from "../router";
import { TEST_URL, type TestProject } from "../testing/project";
import { MemoryBlobStore } from "./blob-store";
import { deleteStorageFile, listBucketFiles, listStorageBuckets } from "./dashboard";
import { newStorageTestProject } from "./testing";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const MIGRACION = `
insert into storage.buckets (id, name, public) values ('fotos', 'fotos', true), ('vacio', 'vacio', false);
`;
let t: TestProject;
let project: BackendProject;
const store = new MemoryBlobStore();

async function subir(bucket: string, name: string, bytes: number, mime = "image/png") {
  await t.pg.exec(`set role supabase_storage_admin`);
  await t.pg.query(`insert into storage.objects (bucket_id, name, version, metadata) values ($1, $2, 'v1', $3::jsonb)`, [
    bucket,
    name,
    JSON.stringify({ size: bytes, mimetype: mime }),
  ]);
  await t.pg.exec(`reset role`);
  await store.put(`${t.project.ref}/${bucket}/${name}/v1`, new Response(new Uint8Array(bytes)).body!, { contentType: mime, cacheControl: "", maxBytes: 1e9 });
}

beforeAll(async () => {
  t = await newStorageTestProject(MIGRACION);
  project = { ...t.project, storage: { store } };
  await subir("fotos", "a.png", 10);
  await subir("fotos", "u1/b.png", 30);
});

describe("panel: Storage", () => {
  it("los buckets, con cuántos ficheros y cuánto ocupan", async () => {
    expect(await listStorageBuckets(project)).toEqual([
      { id: "fotos", public: true, files: 2, bytes: 40, fileSizeLimit: null, allowedMimeTypes: null },
      { id: "vacio", public: false, files: 0, bytes: 0, fileSizeLimit: null, allowedMimeTypes: null },
    ]);
  });

  it("los ficheros de un bucket, con un enlace firmado de 10 minutos para abrirlos", async () => {
    const files = await listBucketFiles(project, TEST_URL, "fotos");
    expect(files.map((f) => ({ name: f.name, size: f.size, mimetype: f.mimetype }))).toEqual([
      { name: "a.png", size: 10, mimetype: "image/png" },
      { name: "u1/b.png", size: 30, mimetype: "image/png" },
    ]);
    const url = new URL(files[1]!.url);
    expect(url.origin + url.pathname).toBe(`${TEST_URL}/storage/v1/object/sign/fotos/u1/b.png`);
    const v = await verifyJwt(t.project.jwtSecret, url.searchParams.get("token")!);
    expect(v.ok && v.claims).toMatchObject({ url: "fotos/u1/b.png", scope: "download" });
    expect(v.ok && (v.claims.exp as number) - (v.claims.iat as number)).toBe(600);
  });

  it("borrar un fichero se lleva la fila y el blob", async () => {
    expect(await deleteStorageFile(project, "fotos", "a.png")).toEqual({ ok: true });
    expect((await listBucketFiles(project, TEST_URL, "fotos")).map((f) => f.name)).toEqual(["u1/b.png"]);
    expect(store.keys().some((k) => k.includes("/fotos/a.png/"))).toBe(false);
    expect(await deleteStorageFile(project, "fotos", "no-esta.png")).toEqual({ error: "Object not found" });
  });

  it("sin almacén: los buckets se ven, borrar dice por qué no", async () => {
    const sin = { ...t.project, storage: { store: null } };
    expect((await listStorageBuckets(sin)).length).toBe(2);
    expect(await deleteStorageFile(sin, "fotos", "u1/b.png")).toEqual({ error: "Storage is not available on this server" });
  });
});
