// The phone app's preview runs the project on its canvas host, the one the web workspace shows: the share link
// (/p/<id>) serves data.html as it is, and an app's data.html is only the shell that starts it.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userId: vi.fn<() => Promise<string | null>>(),
  limit: vi.fn(),
  document: vi.fn((html: string) => `${html}<!--vista-->`),
  save: vi.fn(() => "DOC1"),
  env: vi.fn(async () => ({ VITE_SUPABASE_URL: "https://x" })),
}));

// Who asks is the owner (see acceso-de-prueba.ts).
vi.mock("@/lib/projects/acceso", () => import("@/lib/projects/acceso-de-prueba"));
vi.mock("@/lib/movil/quien", () => ({ usuarioDeLaPeticion: mocks.userId }));
vi.mock("drizzle-orm", () => ({ and: (...a: unknown[]) => a, eq: (l: unknown, r: unknown) => [l, r] }));
vi.mock("@/lib/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: mocks.limit }) }) }) },
  schema: { projects: { id: "id", userId: "userId", data: "data", title: "title", subdomain: "subdomain", logoUrl: "logoUrl" } },
}));
vi.mock("@/lib/lienzo/documento", () => ({ documentoDeVista: mocks.document }));
vi.mock("@/lib/lienzo/almacen", () => ({ guardarDocumento: mocks.save }));
vi.mock("@/lib/apps/entorno", () => ({ entornoPublicoDeLaApp: mocks.env }));

import { OPTIONS, POST } from "./route";
import { etiquetaDeLienzo } from "@/lib/lienzo/host";
import { ORIGENES_DE_LA_APP } from "@/lib/movil/cors";

const ID = "4f9c10cb-8781-48f1-b291-c5d146579f09";
const SECRET = "s3cr3t";
const LABEL = etiquetaDeLienzo(ID, { AUTH_SECRET: SECRET })!;
const APP = { catalogo: "2026-11", entrada: "/src/main.jsx" };
const SHELL = '<div id="root"></div><script type="module" src="/src/main.jsx"></script>';

const ask = (body: unknown, origin = "https://localhost") =>
  new Request("https://openlen.com/api/movil/canvas", {
    method: "POST",
    headers: { host: "openlen.com", origin, authorization: "Bearer key", "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("AUTH_SECRET", SECRET);
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("PUBLISH_BASE_HOST", "openlen.app");
  mocks.userId.mockResolvedValue("u1");
  mocks.limit.mockResolvedValue([
    { data: { html: SHELL, app: APP, pages: { menu: { html: "<p>menu</p>" } }, settings: {} }, title: "Punto de venta", subdomain: null, logoUrl: null },
  ]);
});

describe("POST /api/movil/canvas", () => {
  it("🔴 an app: the saved shell on the canvas host, where it runs, and the phone may frame it", async () => {
    const res = await POST(ask({ projectId: ID }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: `https://${LABEL}.openlen.app/?__lienzo=DOC1` });
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        html: `${SHELL}<!--vista-->`,
        projectId: ID,
        userId: "u1",
        pagina: null,
        app: APP,
        entorno: { VITE_SUPABASE_URL: "https://x" },
        framedBy: ORIGENES_DE_LA_APP,
      }),
    );
    // Its backend is the draft's, like the web canvas: never production.
    expect(mocks.env).toHaveBeenCalledWith(ID, "draft");
  });

  it("a page: what is saved, at the path it will have once published", async () => {
    mocks.limit.mockResolvedValue([{ data: { html: "<p>home</p>", pages: { menu: { html: "<p>menu</p>" } } }, title: "T", subdomain: null, logoUrl: null }]);
    expect(await (await POST(ask({ projectId: ID }))).json()).toEqual({ url: `https://${LABEL}.openlen.app/?__lienzo=DOC1` });
    expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ html: "<p>home</p><!--vista-->", app: null }));
    expect(await (await POST(ask({ projectId: ID, page: "menu" }))).json()).toEqual({
      url: `https://${LABEL}.openlen.app/menu/index.html?__lienzo=DOC1`,
    });
    expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ html: "<p>menu</p><!--vista-->", pagina: "menu" }));
    expect(mocks.env).not.toHaveBeenCalled();
  });

  it("answers the phone app's origin (CORS), like every route the app calls", async () => {
    const res = await POST(ask({ projectId: ID }));
    expect(res.headers.get("access-control-allow-origin")).toBe("https://localhost");
    expect((await OPTIONS(ask({}))).status).toBe(204);
  });

  it("401 without a key or a session, and opens nothing", async () => {
    mocks.userId.mockResolvedValue(null);
    expect((await POST(ask({ projectId: ID }))).status).toBe(401);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("404 for a project you can't open, or a page it doesn't have", async () => {
    mocks.limit.mockResolvedValue([]);
    expect((await POST(ask({ projectId: ID }))).status).toBe(404);
    mocks.limit.mockResolvedValue([{ data: { html: "<p>home</p>", pages: {} }, title: "T", subdomain: null, logoUrl: null }]);
    expect((await POST(ask({ projectId: ID, page: "nope" }))).status).toBe(404);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("400 without a project id", async () => {
    expect((await POST(ask({}))).status).toBe(400);
  });

  it("503 without a canvas host (the app falls back to the share link)", async () => {
    vi.stubEnv("AUTH_SECRET", "");
    vi.stubEnv("NEXTAUTH_SECRET", "");
    expect((await POST(ask({ projectId: ID }))).status).toBe(503);
    vi.stubEnv("AUTH_SECRET", SECRET);
    vi.stubEnv("OPENLEN_LIENZO_ORIGEN", "0");
    expect((await POST(ask({ projectId: ID }))).status).toBe(503);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
