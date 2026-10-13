// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ guardarLoDeLaTerminal: vi.fn(), cargarFicherosDeLaTerminal: vi.fn(), autor: vi.fn(), deps: {} as Record<string, unknown> }));
vi.mock("@/lib/agent/herramientas-de-ficheros", () => ({ guardarLoDeLaTerminal: m.guardarLoDeLaTerminal, cargarFicherosDeLaTerminal: m.cargarFicherosDeLaTerminal }));
vi.mock("@/lib/agent/tools", () => ({ realDeps: () => m.deps }));
vi.mock("@/lib/projects/autor-del-cambio", () => ({
  conAutor: (id: string, fn: () => unknown) => {
    m.autor(id);
    return fn();
  },
}));

import type { ToolResult } from "./results";
import { applyChanges, checkVersion } from "./writes";
import { fileVersion } from "./file-version";

const caller = { userId: "member", tokenId: "t1", scopes: new Set(["projects:write" as const]), projectId: null };
const open = { projectId: "p1", acceso: { rol: "editor" as const, duenoId: "owner" }, row: { data: { html: "", app: null } } } as never;
const text = (r: ToolResult) => (r.content[0] as { type: "text"; text: string }).text;

beforeEach(() => {
  m.guardarLoDeLaTerminal.mockReset();
  m.cargarFicherosDeLaTerminal.mockReset();
  m.autor.mockReset();
  m.deps = {};
});

describe("🔴 lo que rompe una app vuelve como diagnóstico al escribir (medido en el ensayo del 12/10)", () => {
  it("la terminal guarda con «bash» y no los pide: el MCP los calcula tras guardar, sólo los nuevos", async () => {
    const app = { catalogo: "2026-11", entrada: "/src/main.tsx" };
    const appOpen = { projectId: "a1", acceso: { rol: "dueno" as const, duenoId: "u1" }, row: { data: { html: "<div id=root>", app } } } as never;
    m.guardarLoDeLaTerminal.mockResolvedValue({ notas: [], rechazado: false, enLaTerminal: { "/src/App.tsx": "const = ;" }, escrituras: [] });
    m.cargarFicherosDeLaTerminal.mockResolvedValue({ "/index.html": "<div id=root>", "/src/App.tsx": "const = ;" });
    const r = await applyChanges(caller, appOpen, [{ tipo: "escrito", ruta: "/src/App.tsx", contenido: "const = ;", crea: false }], {
      "/index.html": "<div id=root>",
      "/src/App.tsx": "export const a = 1;",
    });
    expect(r.ok && r.diagnostics).toContain("<new-diagnostics>");
    expect(r.ok && r.diagnostics).toContain("/src/App.tsx");
  });

  it("en una página no hay compilación que pedir", async () => {
    m.guardarLoDeLaTerminal.mockResolvedValue({ notas: [], rechazado: false, enLaTerminal: {}, escrituras: [] });
    const r = await applyChanges(caller, open, [{ tipo: "escrito", ruta: "/index.html", contenido: "<p>", crea: false }], {});
    expect(r.ok && r.diagnostics).toBeNull();
    expect(m.cargarFicherosDeLaTerminal).not.toHaveBeenCalled();
  });
});

describe("la puerta de escritura del MCP", () => {
  it("escribe por guardarLoDeLaTerminal, como la persona y con su nombre en Versiones", async () => {
    m.guardarLoDeLaTerminal.mockResolvedValue({ notas: ["src/App.tsx: saved."], rechazado: false, enLaTerminal: { "/src/App.tsx": "x" }, escrituras: [] });
    const r = await applyChanges(caller, open, [{ tipo: "escrito", ruta: "/src/App.tsx", contenido: "x", crea: false }], { "/src/App.tsx": "y" });
    expect(r.ok).toBe(true);
    expect(m.autor).toHaveBeenCalledWith("member");
    const [session] = m.guardarLoDeLaTerminal.mock.calls[0]!;
    expect(session).toMatchObject({ projectId: "p1", userId: "owner", personId: "member", autor: "usuario", desde: "mcp" });
  });

  it("lo que la puerta rechaza llega al modelo con su motivo (nada escrito)", async () => {
    m.guardarLoDeLaTerminal.mockResolvedValue({ notas: ["AGENTS.md: not saved — it is read-only."], rechazado: true, enLaTerminal: {}, escrituras: [] });
    const r = await applyChanges(caller, open, [{ tipo: "escrito", ruta: "/AGENTS.md", contenido: "x", crea: false }], {});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(text(r.result)).toContain("rejected");
      expect(text(r.result)).toContain("read-only");
    }
  });

  it("los diagnósticos de una app vuelven como <new-diagnostics>, igual que a Len", async () => {
    m.guardarLoDeLaTerminal.mockResolvedValue({
      notas: [], rechazado: false, enLaTerminal: { "/src/App.tsx": "x" },
      escrituras: [{ response: { ok: true }, diagnosticos: [{ ruta: "/src/App.tsx", linea: 2, columna: 3, gravedad: "Error", mensaje: "Unexpected token" }] }],
    });
    const r = await applyChanges(caller, open, [{ tipo: "escrito", ruta: "/src/App.tsx", contenido: "x", crea: false }], {});
    expect(r.ok && r.diagnostics).toContain("<new-diagnostics>");
    expect(r.ok && r.diagnostics).toContain("Unexpected token");
  });
});

describe("la versión que exige la escritura", () => {
  it("la misma versión pasa; otra, se rechaza diciendo la actual", () => {
    const tree = { "/a.txt": "hola" };
    expect(checkVersion(tree, "/a.txt", fileVersion("hola"))).toBeNull();
    const r = checkVersion(tree, "/a.txt", "000000000000");
    expect(r && text(r)).toContain("version_conflict");
    expect(r && text(r)).toContain(fileVersion("hola"));
  });
});

describe("open npm through the MCP", () => {
  it("🔴 what installing said comes back, and the compiler sees the new lock (no «not installed»)", async () => {
    const app = { catalogo: "2026-11", entrada: "/src/main.tsx" };
    const appOpen = { projectId: "a1", acceso: { rol: "dueno" as const, duenoId: "u1" }, row: { data: { html: '<div id="root"></div><script type="module" src="/src/main.tsx"></script>', app } } } as never;
    const source = 'import tiny from "tiny";\nexport default tiny;\n';
    const pkg = '{"dependencies":{"tiny":"^1.0.0"}}';
    const set = { entry: "https://esm.sh/tiny@1.0.0?target=es2022", modules: {} };
    const lock = JSON.stringify({ lockfileVersion: 1, packages: { tiny: { version: "1.0.0", publishedAt: "2026-01-01T00:00:00.000Z", externals: [], development: { "": set }, production: { "": set }, assets: {}, types: null, warnings: [], bytes: 0 } } });
    m.guardarLoDeLaTerminal.mockResolvedValue({
      notas: [], rechazado: false, enLaTerminal: { "/src/main.tsx": source, "/package.json": pkg }, escrituras: [],
      npmNotes: [{ ruta: "/package.json", linea: 1, columna: 1, gravedad: "Info", mensaje: "Installed tiny@1.0.0 from npm (esm.sh).", codigo: "npm", fuente: "npm" }],
    });
    // The terminal's files don't carry /.openlen; the server's do.
    m.cargarFicherosDeLaTerminal.mockResolvedValue({ "/index.html": '<div id="root"></div><script type="module" src="/src/main.tsx"></script>', "/src/main.tsx": source, "/package.json": pkg });
    m.deps = { projectFiles: async () => ({ "/src/main.tsx": source, "/package.json": pkg, "/.openlen/esm-lock.json": lock }) };
    const r = await applyChanges(caller, appOpen, [{ tipo: "escrito", ruta: "/src/main.tsx", contenido: source, crea: false }], { "/src/main.tsx": "export {};" });
    expect(r.ok && r.diagnostics).toContain("Installed tiny@1.0.0 from npm (esm.sh).");
    expect(r.ok && r.diagnostics).not.toContain("not installed");
  });
});
