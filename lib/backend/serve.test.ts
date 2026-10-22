// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const served: string[] = [];
const state = { hasLive: true, draftProvisioned: true, liveStatus: 404 };

vi.mock("./pg", () => ({ backendConfigured: () => true }));
vi.mock("@/lib/lienzo/host", () => ({ etiquetaDeLienzo: () => "lienzo-0123456789abcdef0123456789abcdef" }));
vi.mock("./environments", () => ({
  getEnvironment: async (_id: string, env: string) => (env === "draft" && state.draftProvisioned ? { environment: "draft", provisionedAt: new Date() } : null),
}));
vi.mock("./registry", () => ({
  backendForHost: async () => ({ record: { projectId: "p1", ref: "abcdefghijklmnopqrst" }, pageSub: "tienda" }),
  hasLiveEnvironment: async () => state.hasLive,
  ensureEnvironmentReady: async (_rec: unknown, env: string) => ({ environment: env, scope: env }),
  backendProjectFor: (_hb: unknown, e: { environment: string }) => ({ env: e.environment }),
}));
vi.mock("./router", () => ({
  handleBackendRequest: async (_req: Request, p: { env: string }) => {
    served.push(p.env);
    return new Response("x", { status: p.env === "live" ? state.liveStatus : 200 });
  },
}));

import { serveBackend } from "./serve";

const req = (path: string, headers: Record<string, string> = {}) =>
  new Request(`https://abcdefghijklmnopqrst.openlen.app${path}`, { headers: { host: "abcdefghijklmnopqrst.openlen.app", ...headers } });

beforeEach(() => {
  served.length = 0;
  Object.assign(state, { hasLive: true, draftProvisioned: true, liveStatus: 404 });
});

describe("cada petición a su entorno", () => {
  it("desde el lienzo de este proyecto, al borrador", async () => {
    await serveBackend(req("/rest/v1/productos", { origin: "https://lienzo-0123456789abcdef0123456789abcdef.openlen.app" }));
    expect(served).toEqual(["draft"]);
  });

  it("desde el lienzo de otro proyecto, 403 y nada servido", async () => {
    const res = await serveBackend(req("/rest/v1/productos", { origin: "https://lienzo-ffffffffffffffffffffffffffffffff.openlen.app" }));
    expect(res.status).toBe(403);
    expect(served).toEqual([]);
  });

  it("desde la publicada, a producción", async () => {
    await serveBackend(req("/rest/v1/productos", { origin: "https://tienda.openlen.app" }));
    expect(served).toEqual(["live"]);
  });

  it("un <img> público sin atribuir que no está en producción se busca en el borrador", async () => {
    const res = await serveBackend(req("/storage/v1/object/public/fotos/a.png"));
    expect(served).toEqual(["live", "draft"]);
    expect(res.status).toBe(200);
  });

  it("si sí está en producción, no se mira el borrador", async () => {
    state.liveStatus = 200;
    await serveBackend(req("/storage/v1/object/public/fotos/a.png"));
    expect(served).toEqual(["live"]);
  });

  it("una lectura pública ATRIBUIDA a la publicada no cae al borrador", async () => {
    await serveBackend(req("/storage/v1/object/public/fotos/a.png", { referer: "https://tienda.openlen.app/" }));
    expect(served).toEqual(["live"]);
  });
});

// LA CAJA DE LEN (plan local 2026-10-21-playwright-in-the-box): con su marca, producción sólo se LEE.
describe("lo que llega de la caja de Len", () => {
  const box = (method: string, origin?: string) =>
    new Request("https://abcdefghijklmnopqrst.openlen.app/rest/v1/leads", {
      method,
      headers: { host: "abcdefghijklmnopqrst.openlen.app", "x-openlen-caja": "p1.whatever", ...(origin ? { origin } : {}) },
      ...(method === "POST" ? { body: "{}" } : {}),
    });

  it("lee producción", async () => {
    await serveBackend(box("GET"));
    expect(served).toEqual(["live"]);
  });

  it("🔴 nunca escribe en producción: 403 y nada servido", async () => {
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      served.length = 0;
      const res = await serveBackend(box(method));
      expect(res.status, method).toBe(403);
      expect(await res.text()).toContain("production");
      expect(served).toEqual([]);
    }
  });

  it("al borrador (desde el lienzo) escribe como siempre", async () => {
    const res = await serveBackend(box("POST", "https://lienzo-0123456789abcdef0123456789abcdef.openlen.app"));
    expect(res.status).toBe(200);
    expect(served).toEqual(["draft"]);
  });
});
