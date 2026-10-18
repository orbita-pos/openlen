// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  goto: vi.fn(), screenshot: vi.fn(async () => Buffer.from("png")), upload: vi.fn(async (_opts: { key: string }) => ({ url: "https://image.test/ok.avif" })),
  save: vi.fn(async () => [{ id: "p1" }]), close: vi.fn(async () => {}), soltar: vi.fn(), guard: vi.fn(),
  pageError: null as null | ((err: Error) => void),
}));
vi.mock("@/lib/db", () => ({ db: { update: () => ({ set: () => ({ where: () => ({ returning: m.save }) }) }) }, schema: { projects: { id: "id", subdomain: "subdomain", publishedAt: "publishedAt", updatedAt: "updatedAt", filesHash: "filesHash", envHash: "envHash" } } }));
vi.mock("@/lib/images", () => ({ processImage: async () => ({ variants: [{ bytes: Buffer.from("avif") }] }) }));
vi.mock("@/lib/storage", () => ({ getStorage: () => ({ upload: m.upload }) }));
vi.mock("@/lib/security/render-ssrf-guard", () => ({ installSubresourceSsrfGuard: m.guard }));
vi.mock("@/lib/ai/visual-quality-renderer", () => ({ lanzarChromium: async () => ({
  newPage: async () => ({ on: (_: string, cb: (e: Error) => void) => { m.pageError = cb; }, goto: m.goto, setContent: async () => {}, setViewport: async () => {}, waitForNetworkIdle: async () => {}, evaluate: async () => {}, screenshot: m.screenshot, close: m.close }), close: m.close,
}) }));
vi.mock("@/lib/ai/origen-de-medida", () => ({ origenDeMedida: async () => ({ origin: "127.0.0.1:7777", publicar: () => ({ url: "http://127.0.0.1:7777/doc/", soltar: m.soltar }) }) }));
vi.mock("@/lib/lienzo/documento", () => ({ documentoDeVista: (h: string) => h, carpetaDeLaVista: async () => ({ files: { "/src/main.jsx": "compiled" } }) }));
import { renderProjectThumbnail } from "./thumbnail";

beforeEach(() => { vi.clearAllMocks(); m.pageError = null; m.goto.mockResolvedValue(undefined); m.save.mockResolvedValue([{ id: "p1" }]); });

it("renders a draft from the preview origin, with its files, and frees the document", async () => {
  const result = await renderProjectThumbnail({ projectId: "p1", html: "<div>app</div>", view: { projectId: "p1", title: "app", sub: null, pagina: null, logoUrl: null, settings: undefined }, draft: { revision: "rev", updatedAt: "now", filesHash: null, envHash: null } });
  expect(result).toBe("https://image.test/ok.avif");
  expect(m.goto).toHaveBeenCalledWith("http://127.0.0.1:7777/doc/", expect.anything());
  expect(m.guard).toHaveBeenCalledWith(expect.anything(), { allowOrigins: ["127.0.0.1:7777"] });
  expect(m.upload.mock.calls[0]?.[0]).toMatchObject({ key: expect.stringContaining("p1-draft-rev-") });
  expect(m.soltar).toHaveBeenCalledOnce();
});

it("does not replace the last good image when the app throws while loading", async () => {
  m.goto.mockImplementationOnce(async () => { m.pageError?.(new Error("broken app")); });
  expect(await renderProjectThumbnail({ projectId: "p1", html: "<div>broken</div>" })).toBeNull();
  expect(m.upload).not.toHaveBeenCalled();
  expect(m.save).not.toHaveBeenCalled();
  expect(m.soltar).toHaveBeenCalledOnce();
});

it("reports no saved image when the source changed or was published during the capture", async () => {
  m.save.mockResolvedValueOnce([]);
  expect(await renderProjectThumbnail({ projectId: "p1", html: "<p>old</p>", draft: { revision: "rev", updatedAt: "old", filesHash: "old-files", envHash: null } })).toBeNull();
});
