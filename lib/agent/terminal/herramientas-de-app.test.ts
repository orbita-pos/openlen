// @vitest-environment node
// `tsc` y `eslint` de la terminal de una app, del lado del hilo de la app (plan 03,
// tarea 5): qué ficheros van al comprobador, qué salida y qué código vuelven.
import { describe, expect, it, vi } from "vitest";
import type { InstallOutcome } from "@/lib/apps/npm/install";
import { serializeEsmLock } from "@/lib/apps/npm/lock";
import type { NodeModulesView } from "@/lib/apps/npm/node-modules";
import { ESM_LOCK_PATH, PACKAGE_JSON_PATH } from "@/lib/apps/npm/paths";
import { appToolsFor, parseInstallArg } from "./herramientas-de-app";

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

  it("🔴 npm abierto: tsc, build y test reciben /package.json y el lock del servidor (la terminal no lleva /.openlen)", async () => {
    const LOCK = '{"lockfileVersion":1,"packages":{}}\n';
    const vistos: Record<string, Record<string, string>> = {};
    const tools = appToolsFor(
      { app: { catalogo: "2026-11", entrada: "/src/main.jsx" }, projectId: "p1" } as never,
      {
        projectFiles: async () => ({ "/.openlen/esm-lock.json": LOCK, "/src/main.jsx": "old" }),
        checkApp: async (files: Record<string, string>) => ((vistos.tsc = files), { typescript: [], eslint: [] }),
        buildApp: async (files: Record<string, string>) => ((vistos.build = files), { ok: true as const, js: "x", map: null, bytes: 1, gzipBytes: 1, ms: 1 }),
        testApp: async (files: Record<string, string>) => ((vistos.test = files), { files: [], notRun: [], blocked: [], ms: 1 }),
      } as never,
    )!;
    const ficheros = { "/src/main.jsx": "x", "/package.json": '{"dependencies":{}}' };
    for (const program of ["tsc", "build", "test"] as const) await tools.run(program, [], ficheros, 120_000);
    for (const program of ["tsc", "build", "test"]) {
      expect(vistos[program]!["/.openlen/esm-lock.json"], program).toBe(LOCK);
      expect(vistos[program]!["/package.json"], program).toBe('{"dependencies":{}}');
      // Lo de la terminal manda: el resto del servidor no pisa nada.
      expect(vistos[program]!["/src/main.jsx"], program).toBe("x");
    }
  });

  it("si el comprobador no llega, lo dice y falla", async () => {
    expect(await montar(null).tools.run("tsc", [], {})).toEqual({ stdout: "", stderr: "tsc: didn't finish in time; try again.\n", exitCode: 1 });
  });
});

describe("npm in an app's terminal (open npm)", () => {
  const APP = { catalogo: "2026-11", entrada: "/src/main.tsx" };
  const outcome: InstallOutcome = {
    files: { [PACKAGE_JSON_PATH]: '{"dependencies":{"three":"^0.186.1"}}\n', [ESM_LOCK_PATH]: '{"lockfileVersion":1,"packages":{}}\n' },
    notes: [{ severity: "Info" as const, message: "Installed three@0.186.1 from npm (esm.sh)." }, { severity: "Warning" as const, message: "three@0.186.1 has no TypeScript types; what it exports is typed as any." }],
    installed: ["three@0.186.1"],
  };
  function tools() {
    const installPackages = vi.fn(async () => outcome);
    const saveProjectFile = vi.fn(async () => ({ versionPrevia: null }));
    const projectFiles = vi.fn(async () => ({ [ESM_LOCK_PATH]: '{"lockfileVersion":1,"packages":{}}\n' }));
    const t = appToolsFor({ app: APP, projectId: "p1", autor: "len" } as never, { checkApp: vi.fn(), installPackages, saveProjectFile, projectFiles } as never)!;
    return { t, installPackages, saveProjectFile };
  }

  it("parses name@range like npm", () => {
    expect(parseInstallArg("three")).toEqual({ name: "three", range: null });
    expect(parseInstallArg("three@^0.186")).toEqual({ name: "three", range: "^0.186" });
    expect(parseInstallArg("@react-three/fiber@9")).toEqual({ name: "@react-three/fiber", range: "9" });
  });

  it("npm install three: installs, saves the lock, returns package.json for the terminal to save, prints like npm", async () => {
    const { t, installPackages, saveProjectFile } = tools();
    const r = await t.run("npm-install", ["three"], { "/src/main.tsx": "export {};" });
    expect(installPackages).toHaveBeenCalledWith(expect.objectContaining({ [ESM_LOCK_PATH]: expect.any(String) }), APP, { add: [{ name: "three", range: null, subpaths: [""], explicit: true }], remove: [] });
    expect((saveProjectFile.mock.calls[0] as unknown[])[1]).toBe(ESM_LOCK_PATH);
    expect(r).toMatchObject({ exitCode: 0, files: { [PACKAGE_JSON_PATH]: outcome.files[PACKAGE_JSON_PATH]! } });
    expect(r.stdout).toMatch(/^\+ three@0\.186\.1\nadded 1 package in \d+\.\ds\n$/);
    expect(r.stderr).toBe("npm warn three@0.186.1 has no TypeScript types; what it exports is typed as any.\n");
  });

  // Real turn, 14/10: `npm install three && ls node_modules/three/` said «No
  // such file»: /node_modules was listed again only when the command ended.
  it("🔴 npm install hands back /node_modules with the new package, and the session reads it until the command is saved", async () => {
    const lock = serializeEsmLock({
      lockfileVersion: 1,
      packages: {
        three: {
          version: "0.186.1", publishedAt: "2026-01-01T00:00:00.000Z", externals: [], development: {}, production: {}, assets: {},
          types: { "/node_modules/@types/three/index.d.ts": "sha" }, typesFrom: { name: "@types/three", version: "0.186.0" }, warnings: [], bytes: 1,
        },
      },
    });
    const installPackages = vi.fn(async () => ({ ...outcome, files: { ...outcome.files, [ESM_LOCK_PATH]: lock } }));
    const session = { app: APP, projectId: "p1", autor: "len" } as { app: typeof APP; projectId: string; autor: string; nodeModulesView?: NodeModulesView };
    const t = appToolsFor(session as never, { checkApp: vi.fn(), installPackages, saveProjectFile: vi.fn(async () => ({ versionPrevia: null })), projectFiles: vi.fn(async () => ({})) } as never)!;
    const r = (await t.run("npm-install", ["three"], { "/src/main.tsx": "export {};" })) as { nodeModules?: readonly string[] };
    expect(r.nodeModules).toContain("/node_modules/three/package.json");
    expect(r.nodeModules).toContain("/node_modules/@types/three/index.d.ts");
    expect(session.nodeModulesView?.paths).toEqual(r.nodeModules);
    expect(JSON.parse((await session.nodeModulesView!.read("/node_modules/three/package.json"))!)).toEqual({ name: "three", version: "0.186.1" });
  });

  it("npm uninstall three asks to remove it", async () => {
    const { t, installPackages } = tools();
    await t.run("npm-uninstall", ["three"], {});
    expect(installPackages).toHaveBeenCalledWith(expect.any(Object), APP, { add: [], remove: ["three"] });
  });

  it("an install error exits 1 with npm error", async () => {
    const { t, installPackages } = tools();
    installPackages.mockResolvedValueOnce({ files: {}, notes: [{ severity: "Error", message: "young: published 10 days ago; packages must be at least 30 days old." }], installed: [] });
    const r = await t.run("npm-install", ["young"], {});
    expect(r).toMatchObject({ exitCode: 1, stderr: "npm error young: published 10 days ago; packages must be at least 30 days old.\n" });
  });
});

describe("npm in an app's terminal: what is already there", () => {
  const APP = { catalogo: "2026-11", entrada: "/src/main.tsx" };
  function tools() {
    const installPackages = vi.fn(async () => ({
      files: { [PACKAGE_JSON_PATH]: '{"dependencies":{"three":"^0.186.1"}}\n' },
      notes: [{ severity: "Info" as const, message: "Installed three@0.186.1 from npm (esm.sh)." }],
      installed: ["three@0.186.1"],
    }));
    const t = appToolsFor({ app: APP, projectId: "p1", autor: "len" } as never, { checkApp: vi.fn(), installPackages, saveProjectFile: vi.fn(), projectFiles: vi.fn(async () => ({})) } as never)!;
    return { t, installPackages };
  }

  it("🔴 the test kit and the catalog's types answer as before: nothing goes to npm", async () => {
    const { t, installPackages } = tools();
    const r = await t.run("npm-install", ["-D", "vitest", "@testing-library/react", "jsdom", "@types/react"], {});
    expect(installPackages).not.toHaveBeenCalled();
    expect(r).toEqual({
      stdout:
        "vitest: already available (tests run with OpenLen's test kit)\n@testing-library/react: already available (test kit)\njsdom: not needed: tests run in a real browser (Chromium), like Vitest's browser mode\n@types/react: already available (its types come with the catalog)\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("🔴 @types of a package installed from esm.sh whose types already came from them: already there, like npm with it installed (Len's real turn installed @types/leaflet as a package)", async () => {
    const locked = { version: "1.9.4", publishedAt: "2026-01-01T00:00:00.000Z", externals: [], development: {}, production: {}, assets: {}, types: {}, typesFrom: { name: "@types/leaflet", version: "1.9.22" }, warnings: [], bytes: 0 };
    const lock = JSON.stringify({ lockfileVersion: 1, packages: { leaflet: locked } });
    const installPackages = vi.fn();
    const t = appToolsFor({ app: APP, projectId: "p1", autor: "len" } as never, { checkApp: vi.fn(), installPackages, saveProjectFile: vi.fn(), projectFiles: vi.fn(async () => ({ "/.openlen/esm-lock.json": lock })) } as never)!;
    const r = await t.run("npm-install", ["-D", "@types/leaflet"], { [PACKAGE_JSON_PATH]: '{"dependencies":{"leaflet":"^1.9.4"}}\n' });
    expect(installPackages).not.toHaveBeenCalled();
    expect(r).toEqual({ stdout: "@types/leaflet: already available (its types come with leaflet)\n", stderr: "", exitCode: 0 });
  });

  it("mixed: the kit line first, the rest installs", async () => {
    const { t, installPackages } = tools();
    const r = await t.run("npm-install", ["vitest", "three"], {});
    expect(installPackages).toHaveBeenCalledWith(expect.any(Object), APP, { add: [{ name: "three", range: null, subpaths: [""], explicit: true }], remove: [] });
    expect(r.stdout).toMatch(/^vitest: already available \(tests run with OpenLen's test kit\)\n\+ three@0\.186\.1\nadded 1 package in /);
  });
});
