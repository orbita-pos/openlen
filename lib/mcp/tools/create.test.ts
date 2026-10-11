// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  topeDeIngestion: vi.fn(),
  createProjectFromHtml: vi.fn(),
  findOrCreateBlankProject: vi.fn(),
  renameProject: vi.fn(),
  nacerComoApp: vi.fn(),
}));
vi.mock("@/lib/ingestion/tope", () => ({ topeDeIngestion: m.topeDeIngestion }));
vi.mock("@/lib/projects/create-from-html", () => ({ createProjectFromHtml: m.createProjectFromHtml }));
vi.mock("@/lib/projects", () => ({ findOrCreateBlankProject: m.findOrCreateBlankProject, renameProject: m.renameProject }));
vi.mock("@/lib/projects/nacer-como-app", () => ({ nacerComoApp: m.nacerComoApp }));

import type { ToolResult } from "../results";
import { createProjectTool } from "./create";

const caller = { userId: "u1", tokenId: "t1", scopes: new Set(["projects:write" as const]), projectId: null };
const text = (r: ToolResult) => (r.content[0] as { type: "text"; text: string }).text;

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.topeDeIngestion.mockResolvedValue(null);
});

describe("create_project", () => {
  it("una página desde HTML, por la misma puerta que «pegar HTML»", async () => {
    m.createProjectFromHtml.mockResolvedValue({ ok: true, projectId: "p1", title: "Café" });
    const out = JSON.parse(text(await createProjectTool.run({ kind: "page", title: "Café", html: "<h1>Café</h1>" }, caller)));
    expect(m.createProjectFromHtml).toHaveBeenCalledWith({ userId: "u1", html: "<h1>Café</h1>", title: "Café", brief: "Created from an AI assistant", tags: ["mcp"] });
    expect(out).toMatchObject({ project_id: "p1", type: "page", editor_url: expect.stringMatching(/\/new\?project=p1$/) });
  });

  it("una app: el proyecto en blanco nace del esqueleto con su título", async () => {
    m.findOrCreateBlankProject.mockResolvedValue("p2");
    m.nacerComoApp.mockResolvedValue(true);
    const out = JSON.parse(text(await createProjectTool.run({ kind: "app", title: "Ventas" }, caller)));
    expect(m.nacerComoApp).toHaveBeenCalledWith({ projectId: "p2", userId: "u1", titulo: "Ventas" });
    expect(m.renameProject).toHaveBeenCalledWith("p2", "u1", "Ventas");
    expect(out).toMatchObject({ project_id: "p2", type: "app" });
  });

  it("el marcador del editor: invalid_html", async () => {
    m.createProjectFromHtml.mockResolvedValue({ ok: false, error: "invalid_html" });
    expect(text(await createProjectTool.run({ kind: "page", title: "x", html: "<div data-slot-path=a>" }, caller))).toContain("invalid_html");
  });

  it("pasado el tope de creación por hora: rate_limited sin crear", async () => {
    m.topeDeIngestion.mockResolvedValue(new Response("{}", { status: 429 }));
    expect(text(await createProjectTool.run({ kind: "app", title: "x" }, caller))).toContain("rate_limited");
    expect(m.findOrCreateBlankProject).not.toHaveBeenCalled();
  });
});
