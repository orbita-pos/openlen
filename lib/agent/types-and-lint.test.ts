// @vitest-environment node
// Tipos y lint tras cada edición de una app, como el LSP de Claude Code (plan 03,
// leído en el binario 2.1.293): la herramienta NO espera; lo que llega se
// entrega antes de la siguiente llamada al modelo. Sin hilo: `checkApp` es un
// doble que contesta cuando cada prueba quiere.
import { describe, expect, it } from "vitest";
import { takeTypesAndLint, typesAndLintAfterWrite } from "./types-and-lint";

const diag = (ruta: string, codigo: string, linea = 1) =>
  ({ ruta, linea, columna: 1, gravedad: "Error" as const, mensaje: `msg ${codigo}`, codigo, fuente: "typescript" as const });
type R = { typescript: ReturnType<typeof diag>[]; eslint: ReturnType<typeof diag>[] };

/** `checkApp` que no contesta hasta que la prueba suelta cada llamada. */
function montar() {
  const llamadas: { files: Record<string, string>; soltar: (r: R | null) => void }[] = [];
  const session = { app: { catalogo: "2026-11", entrada: "/src/main.jsx" } } as never;
  const deps = {
    checkApp: (files: Record<string, string>) => new Promise<R | null>((soltar) => llamadas.push({ files, soltar })),
  } as never;
  const escribir = (written: string[], compileErrors = 0) =>
    typesAndLintAfterWrite({ session, deps, now: { "/src/a.tsx": "a", "/src/b.tsx": "b", "/memoria/x.md": "m" }, written, compileErrors });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { session, llamadas, escribir, tick };
}

describe("tipos y lint como el LSP de Claude Code (plan 03)", () => {
  it("🔴 la herramienta no espera: lo que llega se entrega en la siguiente recogida, una vez", async () => {
    const { session, llamadas, escribir, tick } = montar();
    escribir(["/src/a.tsx"]);
    expect(takeTypesAndLint(session)).toEqual([]); // aún no contestó: nada, sin esperar
    llamadas[0]!.soltar({ typescript: [diag("/src/a.tsx", "TS2322")], eslint: [] });
    await tick();
    expect(takeTypesAndLint(session).map((d) => d.codigo)).toEqual(["TS2322"]);
    expect(takeTypesAndLint(session)).toEqual([]);
  });

  it("sólo los ficheros que Len tocó (los «abiertos»), y al comprobador sólo van los fuentes de la web", async () => {
    const { session, llamadas, escribir, tick } = montar();
    escribir(["/src/a.tsx"]);
    expect(Object.keys(llamadas[0]!.files)).toEqual(["/src/a.tsx", "/src/b.tsx"]);
    llamadas[0]!.soltar({ typescript: [diag("/src/a.tsx", "TS2322"), diag("/src/b.tsx", "TS2339")], eslint: [] });
    await tick();
    expect(takeTypesAndLint(session).map((d) => d.ruta)).toEqual(["/src/a.tsx"]);
  });

  it("🔴 tras editar un fichero, lo ya entregado de ESE fichero se olvida (clearDeliveredForFile): vuelve a salir si sigue", async () => {
    const { session, llamadas, escribir, tick } = montar();
    const r = { typescript: [diag("/src/a.tsx", "TS2322")], eslint: [] };
    escribir(["/src/a.tsx"]);
    llamadas[0]!.soltar(r);
    await tick();
    expect(takeTypesAndLint(session)).toHaveLength(1);
    escribir(["/src/b.tsx"]); // otro fichero: lo de a.tsx ya se dijo
    llamadas[1]!.soltar(r);
    await tick();
    expect(takeTypesAndLint(session)).toEqual([]);
    escribir(["/src/a.tsx"]); // a.tsx otra vez: se vuelve a decir
    llamadas[2]!.soltar(r);
    await tick();
    expect(takeTypesAndLint(session)).toHaveLength(1);
  });

  it("🔴 un resultado viejo se tira (Dropping stale): si otra escritura empezó otro chequeo, sólo vale el último", async () => {
    const { session, llamadas, escribir, tick } = montar();
    escribir(["/src/a.tsx"]);
    escribir(["/src/a.tsx"]);
    llamadas[0]!.soltar({ typescript: [diag("/src/a.tsx", "TS1111")], eslint: [] });
    await tick();
    expect(takeTypesAndLint(session)).toEqual([]);
    llamadas[1]!.soltar({ typescript: [diag("/src/a.tsx", "TS2322")], eslint: [] });
    await tick();
    expect(takeTypesAndLint(session).map((d) => d.codigo)).toEqual(["TS2322"]);
  });

  it("🔴 la identidad lleva el rango, como en Claude Code: el mismo error en dos líneas son dos", async () => {
    const { session, llamadas, escribir, tick } = montar();
    escribir(["/src/a.tsx"]);
    llamadas[0]!.soltar({ typescript: [diag("/src/a.tsx", "TS2322", 3), diag("/src/a.tsx", "TS2322", 9)], eslint: [] });
    await tick();
    expect(takeTypesAndLint(session).map((d) => d.linea)).toEqual([3, 9]);
  });

  it("🔴 con errores de compilación no se comprueba (el compilador ya habló; serían los mismos errores de sintaxis)", () => {
    const { llamadas, escribir } = montar();
    escribir(["/src/a.tsx"], 2);
    expect(llamadas).toHaveLength(0);
  });

  it("si el comprobador falla (null), no queda nada pendiente", async () => {
    const { session, llamadas, escribir, tick } = montar();
    escribir(["/src/a.tsx"]);
    llamadas[0]!.soltar(null);
    await tick();
    expect(takeTypesAndLint(session)).toEqual([]);
  });

  it("en una página (sin app), o sin comprobador, no hace nada", () => {
    const now = { "/src/a.tsx": "a" };
    expect(() => typesAndLintAfterWrite({ session: {} as never, deps: { checkApp: () => { throw new Error("no"); } } as never, now, written: ["/src/a.tsx"], compileErrors: 0 })).not.toThrow();
    expect(() => typesAndLintAfterWrite({ session: { app: { catalogo: "2026-11", entrada: "/src/main.jsx" } } as never, deps: {} as never, now, written: ["/src/a.tsx"], compileErrors: 0 })).not.toThrow();
    expect(takeTypesAndLint({} as never)).toEqual([]);
  });
});
