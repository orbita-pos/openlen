// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ guardarLoDeLaTerminal: vi.fn(), autor: vi.fn() }));
vi.mock("@/lib/agent/herramientas-de-ficheros", () => ({ guardarLoDeLaTerminal: m.guardarLoDeLaTerminal, cargarFicherosDeLaTerminal: vi.fn() }));
vi.mock("@/lib/agent/tools", () => ({ realDeps: () => ({}) }));
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
  m.autor.mockReset();
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
