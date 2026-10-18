// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ row: null as Record<string, unknown> | null, busy: false, files: vi.fn(async () => ({})), render: vi.fn(async (_opts: unknown): Promise<string | null> => "https://image.test/new.avif") }));
vi.mock("@/lib/db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => m.row ? [m.row] : [] }) }) }) }, schema: { projects: { id: "id", updatedAt: "updatedAt" } } }));
vi.mock("@/lib/backend/files", () => ({ listProjectFiles: m.files }));
vi.mock("@/lib/apps/entorno", () => ({ entornoPublicoDeLaApp: async () => ({ VITE_APP: "draft" }) }));
vi.mock("@/lib/agent/direcciones", () => ({ hayTurnoVivoEnElProyecto: () => m.busy }));
vi.mock("./thumbnail", () => ({ renderProjectThumbnail: m.render }));
import { refreshDraftThumbnail } from "./thumbnail-refresh";

beforeEach(() => {
  vi.clearAllMocks(); m.busy = false;
  m.row = { id: "p1", title: "App", logoUrl: null, subdomain: null, publishedAt: null, thumbnailUrl: null, filesHash: null, envHash: null, updatedAt: "2026-10-17 12:00:00.123456", data: { html: '<div id="root"></div>', app: { catalogo: "2026-11", entrada: "/src/main.jsx" } } };
});

it("loads the full draft preview with its environment and precise version guard", async () => {
  expect(await refreshDraftThumbnail("p1")).toBe(true);
  expect(m.files).toHaveBeenCalledWith("p1");
  expect(m.render.mock.calls[0]?.[0]).toMatchObject({ view: { app: { entrada: "/src/main.jsx" }, entorno: { VITE_APP: "draft" }, files: {} }, draft: { updatedAt: "2026-10-17 12:00:00.123456", revision: expect.any(String) } });
});
it("waits for the agent to finish and leaves published projects alone", async () => {
  m.busy = true;
  expect(await refreshDraftThumbnail("p1")).toBe(false);
  m.busy = false; m.row!.subdomain = "published";
  expect(await refreshDraftThumbnail("p1")).toBe(true);
  expect(m.render).not.toHaveBeenCalled();
});
it("does not hide a failed capture as successful work", async () => {
  m.render.mockResolvedValueOnce(null);
  await expect(refreshDraftThumbnail("p1")).rejects.toThrow(/capture/i);
});
