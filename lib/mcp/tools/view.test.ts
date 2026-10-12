// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ openProject: vi.fn(), consumeQuota: vi.fn(), captureProjectView: vi.fn(), acquireCaptureSlot: vi.fn() }));
vi.mock("../access", () => ({ openProject: m.openProject }));
vi.mock("../quota", () => ({ consumeQuota: m.consumeQuota }));
vi.mock("../capture", () => ({ captureProjectView: m.captureProjectView, acquireCaptureSlot: m.acquireCaptureSlot }));
vi.mock("@/lib/agent/tools", () => ({ realDeps: () => ({}) }));
vi.mock("@/lib/lienzo/documento", () => ({
  vistaParaMedir: (projectId: string, _f: unknown, pagina: string | null) => ({ projectId, pagina }),
  vistaConCarpeta: async (v: unknown) => v,
  pantallaDe: (s: string) => `#${s}`,
}));

import { getCapture } from "../capture-store";
import type { ToolResult } from "../results";
import { viewPageTool } from "./view";

const caller = { userId: "u1", tokenId: "t1", scopes: new Set(["projects:read" as const]), projectId: null };
const page = (data: object) => ({ ok: true, acceso: { rol: "dueno", duenoId: "u1" }, row: { title: "T", subdomain: null, data } });
const textAt = (r: ToolResult, i: number) => (r.content[i] as { type: "text"; text: string }).text;

const release = vi.fn();

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  release.mockReset();
  m.consumeQuota.mockResolvedValue(null);
  m.acquireCaptureSlot.mockReturnValue(release);
});

describe("view_page", () => {
  it("🔴 con todos los Chromium ocupados: busy accionable, sin capturar ni gastar cupo", async () => {
    m.openProject.mockResolvedValue(page({ html: "<p>" }));
    m.acquireCaptureSlot.mockReturnValue(null);
    const r = await viewPageTool.run({ project_id: "p1" }, caller);
    expect(r.isError).toBe(true);
    expect(textAt(r, 0)).toContain("busy");
    expect(m.captureProjectView).not.toHaveBeenCalled();
    expect(m.consumeQuota).not.toHaveBeenCalled();
  });

  it("suelta su hueco al terminar, también si la captura lanza", async () => {
    m.openProject.mockResolvedValue(page({ html: "<p>" }));
    m.captureProjectView.mockRejectedValue(new Error("boom"));
    await expect(viewPageTool.run({ project_id: "p1" }, caller)).rejects.toThrow("boom");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("una subpágina: la imagen primero y UN bloque de texto con las medidas", async () => {
    m.openProject.mockResolvedValue(page({ html: "<p>home", pages: { precios: { html: "<p>precios" } } }));
    m.captureProjectView.mockResolvedValue({ image: { mimeType: "image/jpeg", dataBase64: "B64" }, measurements: "Nothing overflows." });
    const r = await viewPageTool.run({ project_id: "p1", page: "precios" }, caller);
    expect(m.captureProjectView).toHaveBeenCalledWith(expect.objectContaining({ html: "<p>precios", viewport: "desktop", fullPage: false }));
    expect(r.content[0]).toEqual({ type: "image", data: "B64", mimeType: "image/jpeg" });
    expect(r.content).toHaveLength(2);
    expect(textAt(r, 1)).toContain("Nothing overflows.");
  });

  it("el texto lleva la URL de la captura (para clientes que no ven la imagen), y la URL la sirve", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://openlen.com");
    m.openProject.mockResolvedValue(page({ html: "<p>" }));
    m.captureProjectView.mockResolvedValue({ image: { mimeType: "image/jpeg", dataBase64: Buffer.from("jpg").toString("base64") }, measurements: "ok" });
    const r = await viewPageTool.run({ project_id: "p1" }, caller);
    const id = /\/api\/mcp\/capture\/([A-Za-z0-9_-]{43})/.exec(textAt(r, 1))?.[1];
    expect(textAt(r, 1)).toContain("https://openlen.com/api/mcp/capture/");
    expect(getCapture(id!)?.bytes.toString()).toBe("jpg");
  });

  it("una página que no existe: error con las que hay, y sin gastar cupo", async () => {
    m.openProject.mockResolvedValue(page({ html: "<p>", pages: { precios: { html: "" } } }));
    const r = await viewPageTool.run({ project_id: "p1", page: "nada" }, caller);
    expect(r.isError).toBe(true);
    expect(textAt(r, 0)).toContain("precios");
    expect(m.consumeQuota).not.toHaveBeenCalled();
  });

  it("si no sale ni la captura ni la medida: render_failed accionable", async () => {
    m.openProject.mockResolvedValue(page({ html: "<p>" }));
    m.captureProjectView.mockResolvedValue({ image: null, measurements: null });
    const r = await viewPageTool.run({ project_id: "p1" }, caller);
    expect(r.isError).toBe(true);
    expect(textAt(r, 0)).toContain("render_failed");
  });

  it("en una app, screen abre esa pantalla", async () => {
    m.openProject.mockResolvedValue(page({ html: "<div id=root>", app: { catalogo: "2026-11", entrada: "/src/main.tsx" } }));
    m.captureProjectView.mockResolvedValue({ image: null, measurements: "ok" });
    await viewPageTool.run({ project_id: "p1", screen: "/ventas" }, caller);
    expect(m.captureProjectView).toHaveBeenCalledWith(expect.objectContaining({ vista: expect.objectContaining({ pantalla: "#/ventas" }) }));
  });
});
