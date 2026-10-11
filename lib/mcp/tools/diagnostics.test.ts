// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  openProject: vi.fn(),
  consumeQuota: vi.fn(),
  erroresDeLaApp: vi.fn(),
  problemasDelCascaron: vi.fn(),
  checkAppInWorker: vi.fn(),
  projectFiles: vi.fn(),
}));
vi.mock("../access", () => ({ openProject: m.openProject }));
vi.mock("../quota", () => ({ consumeQuota: m.consumeQuota }));
vi.mock("@/lib/agent/compila-la-app", () => ({ erroresDeLaApp: m.erroresDeLaApp, problemasDelCascaron: m.problemasDelCascaron }));
vi.mock("@/lib/apps/checker/check-app", () => ({ checkAppInWorker: m.checkAppInWorker }));
vi.mock("@/lib/agent/tools", () => ({ realDeps: () => ({ projectFiles: m.projectFiles }) }));

import type { ToolResult } from "../results";
import { getDiagnosticsTool } from "./diagnostics";

const caller = { userId: "u1", tokenId: "t1", scopes: new Set(["projects:read" as const]), projectId: null };
const parse = (r: ToolResult) => JSON.parse((r.content[0] as { type: "text"; text: string }).text);
const app = { catalogo: "2026-11", entrada: "/src/main.tsx" };

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.consumeQuota.mockResolvedValue(null);
  m.projectFiles.mockResolvedValue({ "/src/App.tsx": "x", "/tests/a.test.ts": "y" });
  m.problemasDelCascaron.mockReturnValue([]);
});

describe("get_diagnostics", () => {
  it("una página no tiene compilación: lo dice y manda a view_page", async () => {
    m.openProject.mockResolvedValue({ ok: true, acceso: { rol: "dueno", duenoId: "u1" }, row: { data: { html: "<p>" } } });
    const out = parse(await getDiagnosticsTool.run({ project_id: "p1" }, caller));
    expect(out.type).toBe("page");
    expect(out.note).toContain("view_page");
    expect(m.consumeQuota).not.toHaveBeenCalled();
  });

  it("una app que no compila: los errores con fichero y línea, y sin pasar tipos (dirían lo mismo)", async () => {
    m.openProject.mockResolvedValue({ ok: true, acceso: { rol: "dueno", duenoId: "u1" }, row: { data: { html: "<div id=root>", app } } });
    m.erroresDeLaApp.mockReturnValue([{ ruta: "/src/App.tsx", linea: 3, columna: 5, mensaje: "Unexpected token" }]);
    const out = parse(await getDiagnosticsTool.run({ project_id: "p1" }, caller));
    expect(out.compile).toEqual(["/src/App.tsx:3:5 — Unexpected token"]);
    expect(out.types_and_lint).toBe("skipped: fix the compile errors first");
    expect(m.checkAppInWorker).not.toHaveBeenCalled();
  });

  it("una app que compila: tipos y lint del comprobador de verdad, sin las pruebas", async () => {
    m.openProject.mockResolvedValue({ ok: true, acceso: { rol: "dueno", duenoId: "u1" }, row: { data: { html: "<div id=root>", app } } });
    m.erroresDeLaApp.mockReturnValue([]);
    m.checkAppInWorker.mockResolvedValue({
      typescript: [{ ruta: "/src/App.tsx", linea: 1, columna: 1, gravedad: "Error", mensaje: "Type 'number' is not assignable", codigo: "TS2322", fuente: "typescript" }],
      eslint: [],
    });
    const out = parse(await getDiagnosticsTool.run({ project_id: "p1" }, caller));
    expect(out.compile).toEqual([]);
    expect(out.types).toEqual(["/src/App.tsx:1:1 — Error TS2322: Type 'number' is not assignable"]);
    expect(out.lint).toEqual([]);
    expect(m.checkAppInWorker).toHaveBeenCalledWith(expect.objectContaining({ catalogo: "2026-11" }));
  });

  it("sin cupo, no se gasta el comprobador", async () => {
    m.openProject.mockResolvedValue({ ok: true, acceso: { rol: "dueno", duenoId: "u1" }, row: { data: { html: "", app } } });
    const err = { content: [{ type: "text", text: "Error (quota_exceeded): x" }], isError: true };
    m.consumeQuota.mockResolvedValue(err);
    expect(await getDiagnosticsTool.run({ project_id: "p1" }, caller)).toBe(err);
    expect(m.erroresDeLaApp).not.toHaveBeenCalled();
  });
});
