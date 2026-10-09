// @vitest-environment node
// `tsc` y `eslint` de la terminal de una app, del lado del hilo de la app (plan 03,
// tarea 5): qué ficheros van al comprobador, qué salida y qué código vuelven.
import { describe, expect, it } from "vitest";
import { appToolsFor } from "./herramientas-de-app";

const d = (ruta: string, fuente: "typescript" | "eslint", gravedad: "Error" | "Warning" = "Error") => ({
  ruta,
  linea: 2,
  columna: 3,
  gravedad,
  mensaje: "m",
  codigo: fuente === "typescript" ? "TS2322" : "no-undef",
  fuente,
});

function montar(r: { typescript: ReturnType<typeof d>[]; eslint: ReturnType<typeof d>[] } | null) {
  const llamadas: Record<string, string>[] = [];
  const tools = appToolsFor(
    { app: { catalogo: "2026-11", entrada: "/src/main.jsx" } } as never,
    { checkApp: async (files: Record<string, string>) => (llamadas.push(files), r) } as never,
  )!;
  return { tools, llamadas };
}

describe("appToolsFor (plan 03, tarea 5)", () => {
  it("sin app o sin comprobador no hay herramientas", () => {
    expect(appToolsFor({} as never, { checkApp: async () => null } as never)).toBeUndefined();
    expect(appToolsFor({ app: { catalogo: "2026-11", entrada: "/src/main.jsx" } } as never, {} as never)).toBeUndefined();
  });

  it("🔴 el catálogo que ve npm install: todo lo que se puede importar, también lo que el manual no lista (los @radix-ui/react-* de shadcn)", () => {
    const { tools } = montar(null);
    expect(tools.catalogSpecifiers).toContain("zod");
    expect(tools.catalogSpecifiers).toContain("@radix-ui/react-dialog");
    expect(tools.catalogSpecifiers.some((s) => s.includes("chunk-"))).toBe(false);
  });

  it("🔴 los @types que ya trae el paquete de tipos del catálogo (react sí; node no, una app en el navegador no tiene Node)", () => {
    const { tools } = montar(null);
    expect(tools.typesPackages).toContain("@types/react");
    expect(tools.typesPackages).toContain("@types/react-dom");
    expect(tools.typesPackages).not.toContain("@types/node");
  });

  it("al comprobador sólo van los fuentes de la web", async () => {
    const { tools, llamadas } = montar({ typescript: [], eslint: [] });
    await tools.run("tsc", [], { "/src/a.tsx": "x", "/AGENTS.md": "y", "/supabase/migrations/1.sql": "z" });
    expect(Object.keys(llamadas[0]!)).toEqual(["/src/a.tsx"]);
  });

  it("tsc: salida de tsc y código 2 con errores, 0 sin ellos", async () => {
    expect(await montar({ typescript: [d("/src/a.tsx", "typescript")], eslint: [] }).tools.run("tsc", ["--noEmit"], {})).toEqual({
      stdout: "src/a.tsx(2,3): error TS2322: m\n",
      stderr: "",
      exitCode: 2,
    });
    expect((await montar({ typescript: [], eslint: [d("/src/a.tsx", "eslint")] }).tools.run("tsc", [], {})).exitCode).toBe(0);
  });

  it("eslint: sólo lo de las rutas pedidas; código 1 si hay errores, 0 si sólo avisos", async () => {
    const r = { typescript: [], eslint: [d("/src/a.tsx", "eslint"), d("/src/lib/b.ts", "eslint", "Warning")] };
    expect((await montar(r).tools.run("eslint", ["."], {})).exitCode).toBe(1);
    const lib = await montar(r).tools.run("eslint", ["./src/lib"], {});
    expect(lib.stdout).toContain("/src/lib/b.ts");
    expect(lib.stdout).not.toContain("/src/a.tsx");
    expect(lib.exitCode).toBe(0);
    expect((await montar(r).tools.run("eslint", ["src/a.tsx", "--fix"], {})).stdout).toContain("/src/a.tsx");
  });

  it("🔴 build: el paquete de producción, con su tamaño como lo dice Vite; con errores, rc 1 y su sitio", async () => {
    const tools = appToolsFor(
      { app: { catalogo: "2026-11", entrada: "/src/main.jsx" } } as never,
      {
        checkApp: async () => null,
        buildApp: async (files: Record<string, string>) =>
          files["/src/roto.ts"]
            ? { ok: false as const, errores: [{ ruta: "/src/roto.ts", linea: 3, columna: 5, mensaje: "Unexpected <" }] }
            : { ok: true as const, js: "x", map: null, bytes: 952_726, gzipBytes: 260_169, ms: 1210 },
      } as never,
    )!;
    const bien = await tools.run("build", [], { "/src/main.jsx": "x" });
    expect(bien.exitCode).toBe(0);
    expect(bien.stdout).toBe("src/main.jsx  952.73 kB │ gzip: 260.17 kB\n✓ built in 1.21s\n");
    const mal = await tools.run("build", [], { "/src/main.jsx": "x", "/src/roto.ts": "<" });
    expect(mal.exitCode).toBe(1);
    expect(mal.stderr).toBe("✘ [ERROR] Unexpected <\n\n    src/roto.ts:3:5:\n\n1 error\n");
  });

  it("si el comprobador no llega, lo dice y falla", async () => {
    expect(await montar(null).tools.run("tsc", [], {})).toEqual({ stdout: "", stderr: "tsc: didn't finish in time; try again.\n", exitCode: 1 });
  });
});
