// @vitest-environment node
//
// La puerta de /storage/v1: la clave (la pasarela de Supabase), el host (sólo
// el del `ref`: un fichero subido nunca vive en el origen de la página), y lo
// que contesta su servidor a una ruta que no existe.
import { beforeAll, describe, expect, it, vi } from "vitest";

import { handleBackendRequest, type BackendProject } from "../router";
import { TEST_REF, TEST_SITE, TEST_URL, type TestProject } from "../testing/project";
import { MemoryBlobStore } from "./blob-store";
import { newStorageTestProject } from "./testing";

// Montar el esquema real (GoTrue + las 73 de storage) en PGlite tarda; en paralelo, más que los 5 s de serie.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

let t: TestProject;
let project: BackendProject;
beforeAll(async () => {
  t = await newStorageTestProject("");
  project = { ...t.project, storage: { store: new MemoryBlobStore() } };
});

const pedir = (url: string, headers: Record<string, string> = {}, p: BackendProject = project) =>
  handleBackendRequest(new Request(url, { headers }), p);

describe("/storage/v1 — la puerta", () => {
  it("sin apikey: lo que contesta la pasarela de Supabase", async () => {
    const r = await pedir(`${TEST_URL}/storage/v1/bucket`);
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ message: "No API key found in request", hint: "No `apikey` request header or url param was found." });
  });

  it("con una clave que no es del proyecto: 401 de la pasarela", async () => {
    const r = await pedir(`${TEST_URL}/storage/v1/bucket`, { apikey: "sb_publishable_otra" });
    expect(r.status).toBe(401);
    expect(await r.json()).toMatchObject({ message: "Invalid API key" });
  });

  it("en el host de la página no hay Storage: 404, aunque la clave sea buena", async () => {
    const r = await pedir(`${TEST_SITE}/storage/v1/bucket`, { apikey: t.secretKey });
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ message: "no Route matched with those values" });
  });

  it("en otro ref tampoco", async () => {
    const r = await pedir(`https://zzzzzzzzzzzzzzzzzzzz.openlen.app/storage/v1/bucket`, { apikey: t.secretKey });
    expect(r.status).toBe(404);
  });

  it("sin almacén configurado (sin R2): 503, no se finge", async () => {
    const r = await pedir(`${TEST_URL}/storage/v1/bucket`, { apikey: t.secretKey }, { ...t.project, storage: { store: null } });
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ message: "Storage is not available on this server" });
  });

  it("una ruta que no existe: el 404 de su servidor", async () => {
    const r = await pedir(`${TEST_URL}/storage/v1/nada/de/nada`, { apikey: t.secretKey });
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({
      statusCode: "404",
      error: "Not Found",
      message: "Route GET:/nada/de/nada not found",
      code: "InvalidRequest",
    });
  });

  it("un JWT de usuario que no vale: AccessDenied de Supabase (400 con statusCode 403)", async () => {
    const r = await pedir(`${TEST_URL}/storage/v1/bucket`, { apikey: t.project.publishableKey, authorization: "Bearer a.b.c" });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ statusCode: "403", code: "AccessDenied", error: "Unauthorized" });
  });

  it("CORS abierto, como Supabase", async () => {
    const r = await handleBackendRequest(
      new Request(`${TEST_URL}/storage/v1/bucket`, { method: "OPTIONS", headers: { origin: "https://tienda.openlen.app" } }),
      project,
    );
    expect(r.headers.get("access-control-allow-origin")).toBe("https://tienda.openlen.app");
  });

  it("sin almacén propio, el del entorno: sin credenciales de R2, 503", async () => {
    vi.stubEnv("R2_ACCOUNT_ID", "");
    try {
      const r = await pedir(`${TEST_URL}/storage/v1/bucket`, { apikey: t.secretKey }, t.project);
      expect(r.status).toBe(503);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("transformar imágenes no está: el 404 de ruta de Supabase con la función apagada", async () => {
    const r = await pedir(`${TEST_URL}/storage/v1/render/image/public/web/x.png?width=100`, { apikey: t.secretKey });
    expect(r.status).toBe(404);
    expect(await r.json()).toMatchObject({ statusCode: "404", error: "Not Found", message: "Route GET:/render/image/public/web/x.png?width=100 not found" });
  });

  it("subidas reanudables (TUS) tampoco: 404 de ruta", async () => {
    const r = await handleBackendRequest(
      new Request(`${TEST_URL}/storage/v1/upload/resumable`, { method: "POST", headers: { apikey: t.secretKey } }),
      project,
    );
    expect(r.status).toBe(404);
  });

  it("el ref de prueba es el del host", () => {
    expect(TEST_URL).toContain(TEST_REF);
  });
});
