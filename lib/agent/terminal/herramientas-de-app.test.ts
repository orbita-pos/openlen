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

describe("npm test (plan 04, tarea 8)", () => {
  it("🔴 test: corre las pruebas con los filtros y -t, y sale con el código de vitest", async () => {
    const pedidos: unknown[] = [];
    const tools = appToolsFor(
      { app: { catalogo: "2026-11", entrada: "/src/main.jsx" } } as never,
      {
        checkApp: async () => null,
        testApp: async (_f: unknown, _a: unknown, o: unknown) => (pedidos.push(o), { files: [], notRun: [], blocked: [], ms: 1 }),
      } as never,
    )!;
    const r = await tools.run("test", ["run", "carrito", "-t", "suma", "--reporter=verbose"], { "/src/main.jsx": "x", "/supabase/x.sql": "y" }, 120_000);
    // El plazo: lo que le queda al comando, menos 5 s para devolver el informe.
    expect(pedidos).toEqual([{ filters: ["carrito"], testNamePattern: "suma", deadlineMs: 119_000 }]);
    expect(r).toEqual({ stdout: "\nNo test files found, exiting with code 1\n\ninclude: **/*.{test,spec}.?(c|m)[jt]s?(x)\n", stderr: "", exitCode: 1 });
  });

  it("🔴 test: la señal de cancelar del comando (`timeout N npm test`) llega a las pruebas", async () => {
    const señales: unknown[] = [];
    const tools = appToolsFor(
      { app: { catalogo: "2026-11", entrada: "/src/main.jsx" } } as never,
      {
        checkApp: async () => null,
        testApp: async (_f: unknown, _a: unknown, o: { signal?: AbortSignal }) => (señales.push(o.signal), { files: [], notRun: [], blocked: [], ms: 1 }),
      } as never,
    )!;
    const cancelar = new AbortController();
    await tools.run("test", [], { "/src/main.jsx": "x" }, 120_000, cancelar.signal);
    expect(señales).toEqual([cancelar.signal]);
  });

  it("test: lleva el entorno de la app (import.meta.env) y TODOS los ficheros, también /tests", async () => {
    const vistos: { f: Record<string, string>; o: Record<string, unknown> }[] = [];
    const tools = appToolsFor(
      { app: { catalogo: "2026-11", entrada: "/src/main.jsx" }, projectId: "p1" } as never,
      {
        checkApp: async () => null,
        entornoDeLaApp: async (id: string) => ({ VITE_SUPABASE_URL: `https://${id}.example` }),
        testApp: async (f: Record<string, string>, _a: unknown, o: Record<string, unknown>) => (vistos.push({ f, o }), { files: [], notRun: [], blocked: [], ms: 1 }),
      } as never,
    )!;
    await tools.run("test", [], { "/src/main.jsx": "x", "/tests/a.test.js": "t" }, 120_000);
    expect(vistos[0]!.o.entorno).toEqual({ VITE_SUPABASE_URL: "https://p1.example" });
    expect(Object.keys(vistos[0]!.f).sort()).toEqual(["/src/main.jsx", "/tests/a.test.js"]);
  });

  it("🔴 test que se queda sin tiempo: lo que vitest habría impreso hasta ahí, y el comando se corta (timedOut, 143)", async () => {
    const tools = appToolsFor(
      { app: { catalogo: "2026-11", entrada: "/src/main.jsx" } } as never,
      {
        checkApp: async () => null,
        testApp: async () => ({
          files: [{ file: "/src/a.test.js", ms: 2, fileError: null, unhandled: [], tests: [{ name: ["x"], state: "pass", ms: 1, error: null }] }],
          notRun: ["/src/b.test.js"],
          blocked: [],
          ms: 3,
        }),
      } as never,
    )!;
    const r = await tools.run("test", [], { "/src/a.test.js": "", "/src/b.test.js": "" }, 10_000);
    expect(r).toEqual({ stdout: "\n RUN  v4.1.11 /\n\n ✓ src/a.test.js (1 test) 2ms\n", stderr: "", exitCode: 143, timedOut: true });
  });

  it("test: lo que no hay, lo dice (--coverage, --watch, -u)", async () => {
    const tools = appToolsFor({ app: { catalogo: "2026-11", entrada: "/src/main.jsx" } } as never, { checkApp: async () => null, testApp: async () => null } as never)!;
    expect((await tools.run("test", ["--coverage"], {}, 120_000)).stderr).toMatch(/coverage isn't available here/);
    expect((await tools.run("test", ["-u"], {}, 120_000)).stderr).toMatch(/snapshots aren't available here/);
    expect((await tools.run("test", [], {}, 120_000)).stderr).toBe("vitest: didn't finish in time; try again.\n");
  });
});

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

  it("🔴 build empaqueta con /.env y el import.meta.env de borrador, como el lienzo (spec local 2026-10-10)", async () => {
    let recibido: { files: Record<string, string>; entorno?: Readonly<Record<string, string>> } | null = null;
    const tools = appToolsFor(
      { app: { catalogo: "2026-11", entrada: "/src/main.jsx" }, projectId: "p1" } as never,
      {
        checkApp: async () => null,
        entornoDeLaApp: async (id: string) => ({ VITE_STRIPE: `pk_test_de_${id}` }),
        buildApp: async (files: Record<string, string>, _app: unknown, o?: { entorno?: Readonly<Record<string, string>> }) => {
          recibido = { files, ...(o?.entorno ? { entorno: o.entorno } : {}) };
          return { ok: true as const, js: "x", map: null, bytes: 1, gzipBytes: 1, ms: 1 };
        },
      } as never,
    )!;
    expect((await tools.run("build", [], { "/src/main.jsx": "x", "/.env": "VITE_A=1", "/tests/a.test.ts": "t" })).exitCode).toBe(0);
    expect(Object.keys(recibido!.files).sort()).toEqual(["/.env", "/src/main.jsx"]);
    expect(recibido!.entorno).toEqual({ VITE_STRIPE: "pk_test_de_p1" });
  });

  it("si el comprobador no llega, lo dice y falla", async () => {
    expect(await montar(null).tools.run("tsc", [], {})).toEqual({ stdout: "", stderr: "tsc: didn't finish in time; try again.\n", exitCode: 1 });
  });
});
