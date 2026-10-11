// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  listProjects: vi.fn(),
  listProjectsByIds: vi.fn(),
  proyectosCompartidos: vi.fn(),
  openProject: vi.fn(),
  cargarFicherosDeLaTerminal: vi.fn(),
}));
vi.mock("@/lib/projects", () => ({ listProjects: m.listProjects, listProjectsByIds: m.listProjectsByIds }));
vi.mock("@/lib/projects/miembros", () => ({ proyectosCompartidos: m.proyectosCompartidos }));
vi.mock("../access", () => ({ openProject: m.openProject }));
vi.mock("@/lib/agent/herramientas-de-ficheros", () => ({ cargarFicherosDeLaTerminal: m.cargarFicherosDeLaTerminal }));
vi.mock("@/lib/agent/tools", () => ({ realDeps: () => ({}) }));

import type { ToolResult } from "../results";
import { getProjectTool, listProjectsTool } from "./projects";

const caller = (projectId: string | null = null) => ({ userId: "u1", tokenId: "t1", scopes: new Set(["projects:read" as const]), projectId });
const summary = (id: string, updated: string, isBlank = false) => ({
  id, title: `T ${id}`, status: "draft", deployUrl: null, hasUnpublishedChanges: false, isBlank, updatedAt: new Date(updated),
});
const parse = (r: ToolResult) => JSON.parse((r.content[0] as { type: "text"; text: string }).text);

beforeEach(() => Object.values(m).forEach((f) => f.mockReset()));

describe("list_projects", () => {
  it("junta los propios y los compartidos, sin los en blanco, del más reciente al más viejo", async () => {
    m.listProjects.mockResolvedValue([summary("a", "2026-10-01"), summary("blank", "2026-10-09", true)]);
    m.proyectosCompartidos.mockResolvedValue([{ projectId: "b", rol: "lector", duenoEmail: "o@x", duenoName: null }]);
    m.listProjectsByIds.mockResolvedValue([summary("b", "2026-10-05")]);
    const out = parse(await listProjectsTool.run({}, caller()));
    expect(out.projects.map((p: { id: string }) => p.id)).toEqual(["b", "a"]);
    expect(out.projects[0]).toMatchObject({ role: "viewer", editor_url: expect.stringMatching(/\/new\?project=b$/) });
    expect(out.projects[1]).toMatchObject({ role: "owner" });
  });

  it("pagina con cursor", async () => {
    m.listProjects.mockResolvedValue([summary("a", "2026-10-03"), summary("b", "2026-10-02"), summary("c", "2026-10-01")]);
    m.proyectosCompartidos.mockResolvedValue([]);
    m.listProjectsByIds.mockResolvedValue([]);
    const first = parse(await listProjectsTool.run({ limit: 2 }, caller()));
    expect(first.projects.map((p: { id: string }) => p.id)).toEqual(["a", "b"]);
    const second = parse(await listProjectsTool.run({ limit: 2, cursor: first.next_cursor }, caller()));
    expect(second.projects.map((p: { id: string }) => p.id)).toEqual(["c"]);
    expect(second.next_cursor).toBeNull();
  });

  it("un token acotado sólo ve su proyecto", async () => {
    m.listProjects.mockResolvedValue([summary("a", "2026-10-01"), summary("p1", "2026-10-02")]);
    m.proyectosCompartidos.mockResolvedValue([]);
    m.listProjectsByIds.mockResolvedValue([]);
    const out = parse(await listProjectsTool.run({}, caller("p1")));
    expect(out.projects.map((p: { id: string }) => p.id)).toEqual(["p1"]);
  });
});

describe("get_project", () => {
  it("dice si es página o app, sus ficheros, sus páginas y dónde está publicado", async () => {
    m.openProject.mockResolvedValue({
      ok: true,
      acceso: { rol: "dueno", duenoId: "u1" },
      row: { title: "Mi app", subdomain: "miapp", publishedAt: new Date("2026-10-01T00:00:00Z"), userBrief: null,
        data: { html: "<div id=root>", app: { catalogo: "2026-11", entrada: "/src/main.tsx" } } },
    });
    m.cargarFicherosDeLaTerminal.mockResolvedValue({ "/index.html": "<div id=root>", "/src/App.tsx": "export default 1", "/AGENTS.md": "manual" });
    const out = parse(await getProjectTool.run({ project_id: "p1" }, caller()));
    expect(out).toMatchObject({
      id: "p1", title: "Mi app", type: "app", role: "owner",
      app: { catalog: "2026-11", entry: "/src/main.tsx" },
      editor_url: expect.stringMatching(/\/new\?project=p1$/),
    });
    expect(out.files).toContainEqual({ path: "/src/App.tsx", bytes: 16 });
    expect(out.files.find((f: { path: string }) => f.path === "/AGENTS.md")).toMatchObject({ read_only: true });
    expect(out.published_url).toContain("miapp");
  });

  it("una página lista sus páginas: / para la portada y el slug para las demás", async () => {
    m.openProject.mockResolvedValue({
      ok: true,
      acceso: { rol: "lector", duenoId: "owner" },
      row: { title: "Mi web", subdomain: null, publishedAt: null, userBrief: null, data: { html: "<p>" } },
    });
    m.cargarFicherosDeLaTerminal.mockResolvedValue({ "/index.html": "<p>", "/precios/index.html": "<p>", "/js/app.js": "1" });
    const out = parse(await getProjectTool.run({ project_id: "p1" }, caller()));
    expect(out).toMatchObject({ type: "page", role: "viewer", published_url: null });
    expect(out.pages.sort()).toEqual(["/", "precios"]);
  });

  it("si no se puede abrir, devuelve el error de openProject tal cual", async () => {
    const err = { content: [{ type: "text", text: "Error (not_found): x" }], isError: true };
    m.openProject.mockResolvedValue({ ok: false, result: err });
    expect(await getProjectTool.run({ project_id: "nope" }, caller())).toBe(err);
  });
});
