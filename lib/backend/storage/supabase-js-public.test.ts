// @vitest-environment node
//
// Lo público (`getPublicUrl`, que storage-js arma sin pedir nada) y lo que se
// sirve de un objeto, contra la LIBRERÍA REAL.
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { handleBackendRequest, type BackendProject } from "../router";
import { TEST_URL, type TestProject } from "../testing/project";
import { MemoryBlobStore } from "./blob-store";
import { newStorageTestProject } from "./testing";

const MIGRACION = `
insert into storage.buckets (id, name, public) values ('web', 'web', true);
insert into storage.buckets (id, name, public) values ('cerrado', 'cerrado', false);
`;

let t: TestProject;
let project: BackendProject;
const store = new MemoryBlobStore();
const pedir = (url: string, init: RequestInit = {}) => handleBackendRequest(new Request(url, init), project);
const admin = () =>
  createClient(TEST_URL, t.secretKey, { global: { fetch: (i, init) => pedir(String(i instanceof Request ? i.url : i), init) }, auth: { persistSession: false } });

beforeAll(async () => {
  t = await newStorageTestProject(MIGRACION);
  project = { ...t.project, storage: { store } };
  const a = admin();
  await a.storage.from("web").upload("logo.png", new Blob([new Uint8Array([9, 8, 7, 6, 5])], { type: "image/png" }));
  await a.storage.from("web").upload("ataque.html", new Blob(["<script>alert(1)</script>"], { type: "text/html" }));
  await a.storage.from("web").upload("ataque.svg", new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], { type: "image/svg+xml" }));
  await a.storage.from("cerrado").upload("secreto.png", new Blob([new Uint8Array([1])], { type: "image/png" }));
});

describe("lo público", () => {
  it("getPublicUrl da la URL de Supabase y se baja SIN clave", async () => {
    const { data } = admin().storage.from("web").getPublicUrl("logo.png");
    expect(data.publicUrl).toBe(`${TEST_URL}/storage/v1/object/public/web/logo.png`);
    const r = await pedir(data.publicUrl);
    expect(r.status).toBe(200);
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([9, 8, 7, 6, 5]);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("cache-control")).toBe("max-age=3600");
  });

  it("un bucket privado por /object/public: Bucket not found", async () => {
    const r = await pedir(`${TEST_URL}/storage/v1/object/public/cerrado/secreto.png`);
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ statusCode: "404", message: "Bucket not found" });
  });

  it("un bucket privado por /object/<bucket> sin clave: Bucket not found (no se enseña sin sesión)", async () => {
    const r = await pedir(`${TEST_URL}/storage/v1/object/cerrado/secreto.png`);
    expect(await r.json()).toMatchObject({ statusCode: "404", message: "Bucket not found" });
  });

  it("Range: 206 y sólo esos bytes", async () => {
    const r = await pedir(`${TEST_URL}/storage/v1/object/public/web/logo.png`, { headers: { range: "bytes=1-3" } });
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toBe("bytes 1-3/5");
    expect(r.headers.get("content-length")).toBe("3");
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([8, 7, 6]);
  });

  it("Range imposible: 416 de Supabase", async () => {
    const r = await pedir(`${TEST_URL}/storage/v1/object/public/web/logo.png`, { headers: { range: "bytes=9-" } });
    expect(r.status).toBe(416);
    expect(await r.json()).toMatchObject({ statusCode: "416", message: "invalid range provided" });
  });
});

describe("un fichero subido nunca se ejecuta (Review Focus 1)", () => {
  it("el HTML sale como texto plano, con nosniff y sandbox", async () => {
    const r = await pedir(`${TEST_URL}/storage/v1/object/public/web/ataque.html`);
    expect(r.headers.get("content-type")).toBe("text/plain");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
  });

  it("el SVG con script lleva sandbox", async () => {
    const r = await pedir(`${TEST_URL}/storage/v1/object/public/web/ataque.svg`);
    expect(r.headers.get("content-type")).toBe("image/svg+xml");
    expect(r.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
  });

  it("y en el host de la página no existe", async () => {
    const r = await pedir(`https://tienda.openlen.app/storage/v1/object/public/web/ataque.html`);
    expect(r.status).toBe(404);
  });
});

describe("lo privado no se queda en la CDN (Review Focus 3)", () => {
  it("download de un bucket privado: Cache-Control private", async () => {
    const r = await pedir(`${TEST_URL}/storage/v1/object/authenticated/cerrado/secreto.png`, {
      headers: { apikey: t.secretKey, authorization: `Bearer ${t.secretKey}` },
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("private, max-age=3600");
  });
});
