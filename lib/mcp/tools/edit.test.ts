// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ loadTreeForWrite: vi.fn(), applyChanges: vi.fn(), consumeQuota: vi.fn() }));
vi.mock("../writes", async (orig) => ({ ...(await orig<typeof import("../writes")>()), loadTreeForWrite: m.loadTreeForWrite, applyChanges: m.applyChanges }));
vi.mock("../quota", () => ({ consumeQuota: m.consumeQuota }));

import { fileVersion } from "../file-version";
import type { ToolResult } from "../results";
import { editFileTool, replaceExact } from "./edit";

const caller = { userId: "u1", tokenId: "t1", scopes: new Set(["projects:write" as const]), projectId: null };
const text = (r: ToolResult) => (r.content.find((c) => c.type === "text") as { type: "text"; text: string }).text;
const FILE = "<h1>Hola</h1>\n<p>Hola</p>\n<footer>Adiós</footer>";

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.consumeQuota.mockResolvedValue(null);
  m.loadTreeForWrite.mockResolvedValue({ ok: true, open: { projectId: "p1" }, tree: { "/index.html": FILE } });
  m.applyChanges.mockImplementation(async (_c: unknown, _o: unknown, cambios: { ruta: string; contenido: string }[]) => ({
    ok: true, saved: { [cambios[0]!.ruta]: cambios[0]!.contenido }, diagnostics: null,
  }));
});

describe("replaceExact", () => {
  it("una sola coincidencia exacta: reemplaza", () => {
    expect(replaceExact(FILE, "Adiós", "Hasta luego", false)).toEqual({ ok: true, content: FILE.replace("Adiós", "Hasta luego"), count: 1 });
  });
  it("ninguna: no_match", () => {
    expect(replaceExact(FILE, "hola mundo", "x", false)).toMatchObject({ ok: false, code: "no_match", count: 0 });
  });
  it("varias sin replace_all: multiple_matches con cuántas", () => {
    expect(replaceExact(FILE, "Hola", "Hi", false)).toMatchObject({ ok: false, code: "multiple_matches", count: 2 });
  });
  it("varias con replace_all: todas", () => {
    expect(replaceExact(FILE, "Hola", "Hi", true)).toMatchObject({ ok: true, count: 2 });
  });
  it("lo mismo por lo mismo: no_change", () => {
    expect(replaceExact(FILE, "Hola", "Hola", true)).toMatchObject({ ok: false, code: "no_change" });
  });
  it("respeta los $ del texto nuevo (no son patrones de reemplazo)", () => {
    expect(replaceExact("precio: X", "X", "$1 y $&", false)).toMatchObject({ ok: true, content: "precio: $1 y $&" });
  });
});

describe("edit_file", () => {
  it("guarda el cambio y devuelve la versión nueva", async () => {
    const r = await editFileTool.run({ project_id: "p1", path: "/index.html", old_string: "Adiós", new_string: "Chao" }, caller);
    const expected = FILE.replace("Adiós", "Chao");
    expect(m.applyChanges).toHaveBeenCalledWith(caller, { projectId: "p1" }, [{ tipo: "escrito", ruta: "/index.html", contenido: expected, crea: false }], expect.anything());
    expect(text(r)).toContain(fileVersion(expected));
  });

  it("varias coincidencias: dice cuántas y cómo arreglarlo, sin escribir", async () => {
    const r = await editFileTool.run({ project_id: "p1", path: "/index.html", old_string: "Hola", new_string: "Hi" }, caller);
    expect(text(r)).toContain("multiple_matches");
    expect(text(r)).toContain("2");
    expect(m.applyChanges).not.toHaveBeenCalled();
  });

  it("con expected_version vieja: conflicto", async () => {
    const r = await editFileTool.run({ project_id: "p1", path: "/index.html", old_string: "Adiós", new_string: "x", expected_version: "000000000000" }, caller);
    expect(text(r)).toContain("version_conflict");
  });

  it("un fichero que no existe: not_found (edit_file no crea)", async () => {
    const r = await editFileTool.run({ project_id: "p1", path: "/nada.html", old_string: "a", new_string: "b" }, caller);
    expect(text(r)).toContain("not_found");
  });
});
