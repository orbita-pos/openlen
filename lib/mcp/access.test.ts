// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { exigirAcceso, loadProject } = vi.hoisted(() => ({ exigirAcceso: vi.fn(), loadProject: vi.fn() }));
vi.mock("@/lib/projects/acceso", () => ({ exigirAcceso }));
vi.mock("@/lib/agent/tools", () => ({ realDeps: () => ({ loadProject }) }));

import { openProject } from "./access";
import type { ToolResult } from "./results";

const caller = (projectId: string | null = null) => ({ userId: "u1", tokenId: "t1", scopes: new Set(["projects:read" as const]), projectId });
const json = (status: number, error: string) => new Response(JSON.stringify({ error }), { status });
const textOf = (r: ToolResult) => (r.content[0] as { type: "text"; text: string }).text;

beforeEach(() => {
  exigirAcceso.mockReset();
  loadProject.mockReset();
});

describe("abrir un proyecto desde el MCP", () => {
  it("un lector puede ver: abre con el dueño y trae la fila", async () => {
    exigirAcceso.mockResolvedValue({ rol: "lector", duenoId: "owner" });
    loadProject.mockResolvedValue({ data: { html: "<p>" }, title: "T", subdomain: null, publishedAt: null, userBrief: null });
    const r = await openProject(caller(), "p1", "ver");
    expect(r.ok).toBe(true);
    expect(exigirAcceso).toHaveBeenCalledWith("p1", "u1", "ver");
    expect(loadProject).toHaveBeenCalledWith("p1", "owner");
  });

  it("quien no es miembro recibe not_found (no se filtra que existe)", async () => {
    exigirAcceso.mockResolvedValue(json(404, "not_found"));
    const r = await openProject(caller(), "p1", "ver");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.result.isError).toBe(true);
      expect(textOf(r.result)).toContain("not_found");
    }
  });

  it("un lector que pide editar recibe read_only", async () => {
    exigirAcceso.mockResolvedValue(json(403, "solo_lectura"));
    const r = await openProject(caller(), "p1", "editar");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(textOf(r.result)).toContain("read_only");
  });

  it("un token acotado a otro proyecto no llega ni a preguntar", async () => {
    const r = await openProject(caller("p2"), "p1", "ver");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(textOf(r.result)).toContain("out_of_scope");
    expect(exigirAcceso).not.toHaveBeenCalled();
  });

  it("si la fila desapareció entre el permiso y la lectura: not_found", async () => {
    exigirAcceso.mockResolvedValue({ rol: "dueno", duenoId: "u1" });
    loadProject.mockResolvedValue(null);
    const r = await openProject(caller(), "p1", "ver");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(textOf(r.result)).toContain("not_found");
  });
});
