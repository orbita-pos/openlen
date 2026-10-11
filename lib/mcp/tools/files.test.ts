// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ openProject: vi.fn(), cargarFicherosDeLaTerminal: vi.fn() }));
vi.mock("../access", () => ({ openProject: m.openProject }));
vi.mock("@/lib/agent/herramientas-de-ficheros", () => ({ cargarFicherosDeLaTerminal: m.cargarFicherosDeLaTerminal }));
vi.mock("@/lib/agent/tools", () => ({ realDeps: () => ({}) }));

import type { ToolResult } from "../results";
import { formatNumbered, MAX_READ_CHARS, readFileTool, searchFilesTool } from "./files";

const caller = { userId: "u1", tokenId: "t1", scopes: new Set(["projects:read" as const]), projectId: null };
const text = (r: ToolResult) => (r.content[0] as { type: "text"; text: string }).text;

beforeEach(() => {
  m.openProject.mockResolvedValue({ ok: true, acceso: { rol: "dueno", duenoId: "u1" }, row: { data: { html: "" } } });
  m.cargarFicherosDeLaTerminal.mockResolvedValue({
    "/index.html": "<h1>Hola</h1>\n<p>mundo</p>",
    "/src/App.tsx": "export function App() {\n  return <div>Hola</div>;\n}",
  });
});

describe("read_file", () => {
  it("devuelve el fichero con números de línea, como cat -n", async () => {
    const out = text(await readFileTool.run({ project_id: "p1", path: "/index.html" }, caller));
    expect(out).toContain("     1\t<h1>Hola</h1>");
    expect(out).toContain("     2\t<p>mundo</p>");
  });

  it("offset y limit cortan por líneas y dicen cómo seguir", () => {
    const big = Array.from({ length: 10 }, (_, i) => `l${i + 1}`).join("\n");
    const out = formatNumbered("/x.ts", big, 3, 2);
    expect(out).toContain("     3\tl3");
    expect(out).toContain("     4\tl4");
    expect(out).not.toContain("l5");
    expect(out).toContain("offset=5");
  });

  it("un fichero enorme se trunca por debajo del tope y dice el offset para seguir", () => {
    const huge = Array.from({ length: 6000 }, (_, i) => `const linea${i} = "${"x".repeat(40)}";`).join("\n");
    const out = formatNumbered("/src/huge.ts", huge, 1, 6000);
    expect(out.length).toBeLessThanOrEqual(MAX_READ_CHARS + 300);
    expect(out).toMatch(/offset=\d+/);
  });

  it("una ruta que no existe sugiere la parecida", async () => {
    const r = await readFileTool.run({ project_id: "p1", path: "/src/app.tsx" }, caller);
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("not_found");
    expect(text(r)).toContain("/src/App.tsx");
  });
});

describe("search_files", () => {
  it("busca con regex en todo el proyecto, estilo grep (ruta:línea: texto)", async () => {
    const out = text(await searchFilesTool.run({ project_id: "p1", pattern: "Hola" }, caller));
    expect(out).toContain("/index.html:1: <h1>Hola</h1>");
    expect(out).toContain("/src/App.tsx:2:   return <div>Hola</div>;");
  });

  it("se puede acotar por carpeta y sin distinguir mayúsculas", async () => {
    const out = text(await searchFilesTool.run({ project_id: "p1", pattern: "hola", path: "/src", case_insensitive: true }, caller));
    expect(out).toContain("/src/App.tsx:2:");
    expect(out).not.toContain("/index.html");
  });

  it("una regex inválida es un error accionable", async () => {
    const r = await searchFilesTool.run({ project_id: "p1", pattern: "(" }, caller);
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("invalid_pattern");
  });
});
