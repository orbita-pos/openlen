// @vitest-environment node
// Tipos y lint tras cada edición de una app, pasivos como el LSP de Claude Code
// (plan 03, tarea 4). Sin hilo: `checkApp` es un doble que devuelve lo que cada
// prueba quiere y cuenta las llamadas.
import { describe, expect, it } from "vitest";
import { typesAndLintDiagnostics, warmTypesAndLint } from "./types-and-lint";

const err = (ruta: string, codigo: string, mensaje = codigo) =>
  ({ ruta, linea: 1, columna: 1, gravedad: "Error" as const, mensaje, codigo, fuente: "typescript" as const });

function montar(resultados: Array<{ typescript: ReturnType<typeof err>[]; eslint: ReturnType<typeof err>[] } | "lento">) {
  const llamadas: Record<string, string>[] = [];
  const session = { app: { catalogo: "2026-11", entrada: "/src/main.jsx" }, carpetaAlEmpezar: new Map([["/src/a.tsx", "viejo"]]) } as never;
  const deps = {
    checkApp: async (files: Record<string, string>) => {
      llamadas.push(files);
      const r = resultados.shift();
      if (r === "lento") return new Promise(() => {});
      return r ?? { typescript: [], eslint: [] };
    },
  } as never;
  return { session, deps, llamadas };
}

describe("tipos y lint, pasivos (plan 03, tarea 4)", () => {
  it("🔴 sólo lo NUEVO desde el inicio del turno, y una sola vez (Review Focus 4)", async () => {
    const viejo = err("/src/a.tsx", "TS1111");
    const nuevo = err("/src/a.tsx", "TS2322");
    const { session, deps } = montar([
      { typescript: [viejo], eslint: [] }, // la línea base: la carpeta al empezar el turno
      { typescript: [viejo, nuevo], eslint: [] }, // tras la primera edición
      { typescript: [viejo, nuevo], eslint: [] }, // tras la segunda: nada nuevo
    ]);
    const now = { "/src/a.tsx": "nuevo" };
    expect((await typesAndLintDiagnostics({ session, deps, now, compileErrors: 0 })).map((d) => d.codigo)).toEqual(["TS2322"]);
    expect(await typesAndLintDiagnostics({ session, deps, now, compileErrors: 0 })).toEqual([]);
  });

  it("🔴 con errores de compilación no se comprueba nada (Review Focus 3)", async () => {
    const { session, deps, llamadas } = montar([]);
    expect(await typesAndLintDiagnostics({ session, deps, now: { "/src/a.tsx": "x" }, compileErrors: 2 })).toEqual([]);
    expect(llamadas).toHaveLength(0);
  });

  it("si no llega a tiempo, lo dice con la herramienta para verlo, y no espera más", async () => {
    const { session, deps } = montar([{ typescript: [], eslint: [] }, "lento"]);
    const t0 = Date.now();
    const r = await typesAndLintDiagnostics({ session, deps, now: { "/src/a.tsx": "x" }, compileErrors: 0, budgetMs: 50 });
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ gravedad: "Info", fuente: "typescript" });
    expect(r[0]!.mensaje).toMatch(/npx tsc --noEmit[\s\S]*npm run lint/);
  });

  it("en una página (sin app), o sin comprobador, no hace nada", async () => {
    const { deps } = montar([]);
    expect(await typesAndLintDiagnostics({ session: {} as never, deps, now: {}, compileErrors: 0 })).toEqual([]);
    expect(await typesAndLintDiagnostics({ session: { app: { catalogo: "2026-11", entrada: "/src/main.jsx" } } as never, deps: {} as never, now: {}, compileErrors: 0 })).toEqual([]);
  });

  it("sólo manda los fuentes de la web, no /memoria ni otros ficheros del proyecto", async () => {
    const { session, deps, llamadas } = montar([]);
    await typesAndLintDiagnostics({ session, deps, now: new Map([["/src/a.tsx", "x"], ["/memoria/notas.md", "y"]]), compileErrors: 0 });
    expect(llamadas.at(-1)).toEqual({ "/src/a.tsx": "x" });
  });

  it("al empezar un turno de una app, el hilo se despierta (como Claude Code arranca sus LSP); en una página, no", async () => {
    const { session, deps, llamadas } = montar([]);
    warmTypesAndLint({} as never, deps);
    expect(llamadas).toHaveLength(0);
    warmTypesAndLint(session, deps);
    expect(llamadas).toEqual([{}]);
    expect(() => warmTypesAndLint(session, {} as never)).not.toThrow();
  });
});
