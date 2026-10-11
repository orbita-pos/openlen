// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ openProject: vi.fn(), textoDeLaPlataforma: vi.fn() }));
vi.mock("../access", () => ({ openProject: m.openProject }));
vi.mock("@/lib/agent/manual-de-la-plataforma", () => ({ textoDeLaPlataforma: m.textoDeLaPlataforma }));

import type { ToolResult } from "../results";
import { getDocsTool } from "./docs";

const caller = { userId: "u1", tokenId: "t1", scopes: new Set(["projects:read" as const]), projectId: null };
const text = (r: ToolResult) => (r.content[0] as { type: "text"; text: string }).text;

beforeEach(() => {
  m.openProject.mockReset();
  m.textoDeLaPlataforma.mockReset();
});

describe("get_docs", () => {
  it("sin proyecto: el manual de las páginas, con la nota de cómo se llaman aquí las herramientas", async () => {
    m.textoDeLaPlataforma.mockReturnValue("# Manual");
    const out = text(await getDocsTool.run({}, caller));
    expect(m.textoDeLaPlataforma).toHaveBeenCalledWith("/AGENTS.md", "len", null);
    expect(out).toContain("read_file");
    expect(out).toContain("# Manual");
  });

  it("con un proyecto que es app: el documento de la app", async () => {
    const app = { catalogo: "2026-11", entrada: "/src/main.tsx" };
    m.openProject.mockResolvedValue({ ok: true, acceso: { rol: "dueno", duenoId: "u1" }, row: { data: { html: "", app } } });
    m.textoDeLaPlataforma.mockReturnValue("# App");
    await getDocsTool.run({ project_id: "p1", doc: "design_guide" }, caller);
    expect(m.textoDeLaPlataforma).toHaveBeenCalledWith("/.openlen/docs/guia-de-diseno.md", "len", app);
  });

  it("un documento que no existe para ese tipo es un error que lo explica", async () => {
    m.textoDeLaPlataforma.mockReturnValue(null);
    const r = await getDocsTool.run({ doc: "libraries" }, caller);
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("not_available");
  });
});
