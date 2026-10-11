// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ loadTreeForWrite: vi.fn(), applyChanges: vi.fn(), consumeQuota: vi.fn() }));
vi.mock("../writes", async (orig) => ({ ...(await orig<typeof import("../writes")>()), loadTreeForWrite: m.loadTreeForWrite, applyChanges: m.applyChanges }));
vi.mock("../quota", () => ({ consumeQuota: m.consumeQuota }));

import { fileVersion } from "../file-version";
import type { ToolResult } from "../results";
import { deleteFileTool, writeFileTool } from "./write";

const caller = { userId: "u1", tokenId: "t1", scopes: new Set(["projects:write" as const]), projectId: null };
const text = (r: ToolResult) => (r.content.find((c) => c.type === "text") as { type: "text"; text: string }).text;
const open = { projectId: "p1", acceso: { rol: "dueno", duenoId: "u1" }, row: { data: { html: "", app: null } } };

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.consumeQuota.mockResolvedValue(null);
  m.loadTreeForWrite.mockResolvedValue({ ok: true, open, tree: { "/index.html": "<p>hola</p>", "/js/app.js": "1" } });
  m.applyChanges.mockImplementation(async (_c: unknown, _o: unknown, cambios: { ruta: string; contenido?: string }[]) => ({
    ok: true,
    saved: Object.fromEntries(cambios.map((c) => [c.ruta, c.contenido ?? null])),
    diagnostics: null,
  }));
});

describe("write_file", () => {
  it("un fichero nuevo se crea sin versión y devuelve la suya", async () => {
    const r = await writeFileTool.run({ project_id: "p1", path: "/js/nuevo.js", content: "2" }, caller);
    expect(m.applyChanges).toHaveBeenCalledWith(caller, open, [{ tipo: "escrito", ruta: "/js/nuevo.js", contenido: "2", crea: true }], expect.anything());
    expect(text(r)).toContain(fileVersion("2"));
  });

  it("🔴 uno que existe exige la versión que leíste (como Claude Code exige haberlo leído)", async () => {
    const r = await writeFileTool.run({ project_id: "p1", path: "/js/app.js", content: "2" }, caller);
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("read_first");
    expect(m.applyChanges).not.toHaveBeenCalled();
  });

  it("🔴 con una versión vieja no pisa: conflicto con la actual", async () => {
    const r = await writeFileTool.run({ project_id: "p1", path: "/js/app.js", content: "2", expected_version: "000000000000" }, caller);
    expect(text(r)).toContain("version_conflict");
    expect(m.applyChanges).not.toHaveBeenCalled();
  });

  it("con la versión buena, sobrescribe y trae los diagnósticos", async () => {
    m.applyChanges.mockResolvedValueOnce({ ok: true, saved: { "/js/app.js": "2" }, diagnostics: "<new-diagnostics>x</new-diagnostics>" });
    const r = await writeFileTool.run({ project_id: "p1", path: "/js/app.js", content: "2", expected_version: fileVersion("1") }, caller);
    expect(text(r)).toContain("<new-diagnostics>");
  });

  it("escribir lo mismo que hay no escribe nada", async () => {
    const r = await writeFileTool.run({ project_id: "p1", path: "/js/app.js", content: "1", expected_version: fileVersion("1") }, caller);
    expect(text(r)).toContain("unchanged");
    expect(m.applyChanges).not.toHaveBeenCalled();
  });
});

describe("delete_file", () => {
  it("borra un fichero de la carpeta con su versión", async () => {
    await deleteFileTool.run({ project_id: "p1", path: "/js/app.js", expected_version: fileVersion("1") }, caller);
    expect(m.applyChanges).toHaveBeenCalledWith(caller, open, [{ tipo: "borrado", ruta: "/js/app.js" }], expect.anything());
  });

  it("🔴 una página no se borra desde aquí: la quita la persona en el editor", async () => {
    const r = await deleteFileTool.run({ project_id: "p1", path: "/index.html", expected_version: fileVersion("<p>hola</p>") }, caller);
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("page_delete_in_editor");
    expect(text(r)).toMatch(/\/new\?project=p1/);
    expect(m.applyChanges).not.toHaveBeenCalled();
  });
});
