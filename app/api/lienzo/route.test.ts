import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  limit: vi.fn(),
  documento: vi.fn((html: string) => `${html}<!--vista-->`),
  guardar: vi.fn(() => "DOC1"),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("drizzle-orm", () => ({ and: (...a: unknown[]) => a, eq: (l: unknown, r: unknown) => [l, r] }));
vi.mock("@/lib/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: mocks.limit }) }) }) },
  schema: { projects: { id: "id", userId: "userId", data: "data", title: "title", subdomain: "subdomain", logoUrl: "logoUrl" } },
}));
vi.mock("@/lib/lienzo/documento", () => ({ documentoDeVista: mocks.documento }));
vi.mock("@/lib/lienzo/almacen", () => ({ guardarDocumento: mocks.guardar }));

import { POST } from "./route";

const ID = "4f9c10cb-8781-48f1-b291-c5d146579f09";
const pide = (body: unknown, host = "localhost:3007") =>
  new Request("http://localhost:3007/api/lienzo", {
    method: "POST",
    headers: { host, "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mocks.auth.mockResolvedValue({ user: { id: "u1" } });
  mocks.limit.mockResolvedValue([
    { data: { html: "<p>g</p>", pages: { menu: { html: "<p>m</p>" } }, settings: {} }, title: "T", subdomain: null, logoUrl: null },
  ]);
});

describe("POST /api/lienzo", () => {
  it("sube el documento horneado y devuelve la URL del lienzo", async () => {
    const res = await POST(pide({ projectId: ID, html: "<p>x</p>" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      url: "http://lienzo-4f9c10cb878148f1b291c5d146579f09.localhost:3007/api/lienzo/DOC1",
    });
    expect(mocks.guardar).toHaveBeenCalledWith(
      expect.objectContaining({ html: "<p>x</p><!--vista-->", projectId: ID, userId: "u1", pagina: null }),
    );
  });

  it("401 sin sesión, y no guarda nada", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await POST(pide({ projectId: ID, html: "x" }))).status).toBe(401);
    expect(mocks.guardar).not.toHaveBeenCalled();
  });

  // Un 4xx/5xx que además NO deja nada en el almacén: subir el documento de un
  // proyecto ajeno sería servir HTML de un usuario bajo la etiqueta de otro.
  it("404 si el proyecto no es tuyo", async () => {
    mocks.limit.mockResolvedValue([]);
    expect((await POST(pide({ projectId: ID, html: "x" }))).status).toBe(404);
    expect(mocks.guardar).not.toHaveBeenCalled();
  });

  it("404 si la página no existe en el proyecto", async () => {
    expect((await POST(pide({ projectId: ID, pagina: "nope", html: "x" }))).status).toBe(404);
    expect(mocks.guardar).not.toHaveBeenCalled();
    expect((await POST(pide({ projectId: ID, pagina: "menu", html: "x" }))).status).toBe(200);
  });

  it("400 con un cuerpo que no es el esperado", async () => {
    expect((await POST(pide("no es json"))).status).toBe(400);
    expect((await POST(pide({ projectId: ID }))).status).toBe(400);
  });

  it("413 por encima de 8 MB", async () => {
    const html = "a".repeat(8 * 1024 * 1024 + 1);
    expect((await POST(pide({ projectId: ID, html }))).status).toBe(413);
  });

  it("503 apagado con la palanca", async () => {
    vi.stubEnv("OPENLEN_LIENZO_ORIGEN", "0");
    const res = await POST(pide({ projectId: ID, html: "x" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "apagado" });
  });

  it("503 sin_host en producción sin dominio configurado", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LIENZO_BASE_HOST", "");
    vi.stubEnv("PUBLISH_BASE_HOST", "");
    const res = await POST(pide({ projectId: ID, html: "x" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "sin_host" });
    expect(mocks.guardar).not.toHaveBeenCalled();
  });
});
