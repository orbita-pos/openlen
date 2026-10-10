// @vitest-environment node
// El empaquetador (plan 02, tarea 3): los módulos que da el compilador + lo que
// usan del catálogo → UN fichero, en su hilo, sin procesos.
import { readFileSync } from "node:fs";
import path from "node:path";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
import { afterAll, describe, expect, it } from "vitest";
import { FICHEROS } from "../shadcn-fixture";
import { esqueletoDeApp } from "../esqueleto";
import { bundleApp, stopBundlerWorker } from "./bundle-app";

afterAll(() => stopBundlerWorker());
const APP = { catalogo: "2026-11", entrada: "/src/main.jsx" } as const;

describe("bundleApp (plan 02, tarea 3)", () => {
  it("🔴 la app shadcn: un fichero, sin un solo import del catálogo por su nombre, y más ligero que hoy (352 KB gzip)", async () => {
    const r = await bundleApp({ carpeta: FICHEROS, app: APP, modo: "produccion" });
    if (!r?.ok) throw new Error(JSON.stringify(r));
    expect(r.js).not.toMatch(/\bfrom\s*["'](?:react|react-dom|zod|recharts|@radix-ui)/);
    expect(r.js).not.toMatch(/\bimport\(\s*["'](?:react|zod)/);
    expect(r.js).toContain("Guardar");
    expect(r.gzipBytes).toBeLessThan(300_000);
    expect(r.map).toBeNull(); // la publicada no lleva mapa
  }, 60_000);

  it("en desarrollo lleva su sourcemap, y una línea del paquete vuelve a su fichero y su línea", async () => {
    const carpeta = { ...esqueletoDeApp({ titulo: "Caja" }).ficheros };
    const r = await bundleApp({ carpeta, app: APP, modo: "desarrollo" });
    if (!r?.ok || !r.map) throw new Error(JSON.stringify(r));
    const mapa = new TraceMap(r.map);
    expect(mapa.sources.some((s) => s === "app:/src/App.jsx")).toBe(true);
    expect(mapa.sources.some((s) => s?.startsWith("vendor:/openlen/vendor/2026-11/"))).toBe(true);
    // La línea del paquete donde está el `createRoot` de main.jsx vuelve a main.jsx.
    const lineas = r.js.split("\n");
    const i = lineas.findIndex((l) => l.includes("createRoot(document.getElementById"));
    const o = originalPositionFor(mapa, { line: i + 1, column: lineas[i]!.indexOf("createRoot") });
    expect(o.source).toBe("app:/src/main.jsx");
  }, 60_000);

  it("🔴 un fichero que NO es la entrada no compila: los diagnósticos del COMPILADOR, con su línea (Review Focus 4)", async () => {
    const carpeta = { ...FICHEROS, "/src/lib/utils.ts": FICHEROS["/src/lib/utils.ts"] + "\nexport const x = <;" };
    const r = await bundleApp({ carpeta, app: APP, modo: "desarrollo" });
    expect(r?.ok).toBe(false);
    if (r && !r.ok) {
      expect(r.errores[0]).toMatchObject({ ruta: "/src/lib/utils.ts", linea: 4 });
    }
  }, 60_000);

  it("🔴 un error de esbuild (tras un `export *`) dice las rutas como Len las escribe, sin el espacio de nombres del empaquetador", async () => {
    const carpeta = {
      ...esqueletoDeApp({ titulo: "Caja" }).ficheros,
      "/src/lib/datos.js": 'export const NOMBRE = "real";',
      "/src/lib/todo.js": 'export * from "./datos";',
      "/src/App.jsx": 'import { APELLIDO } from "./lib/todo";\nexport default function App() { return <p>{APELLIDO}</p>; }',
    };
    const r = await bundleApp({ carpeta, app: APP, modo: "desarrollo" });
    if (!r || r.ok) throw new Error(JSON.stringify(r));
    expect(r.errores[0]).toMatchObject({ ruta: "/src/App.jsx", linea: 1 });
    expect(r.errores[0]!.mensaje).toContain('"/src/lib/todo.js"');
    expect(r.errores[0]!.mensaje).not.toContain("app:");
  }, 60_000);

  it("🔴 sonner (los avisos de shadcn) empaqueta, en desarrollo y en producción (ensayo de caja del 09/10)", async () => {
    const carpeta = {
      ...esqueletoDeApp({ titulo: "Caja" }).ficheros,
      "/src/App.jsx": 'import { Toaster, toast } from "sonner";\nexport default function App() { return <><Toaster /><button onClick={() => toast("Guardado")}>x</button></>; }',
    };
    for (const modo of ["desarrollo", "produccion"] as const) {
      const r = await bundleApp({ carpeta, app: APP, modo });
      if (!r?.ok) throw new Error(`${modo}: ${JSON.stringify(r)}`);
      expect(r.js).toContain("Guardado");
    }
  }, 60_000);

  it("🔴 dos carpetas a la vez: cada una recibe SU paquete; y dos peticiones iguales comparten uno (Review Focus 2)", async () => {
    const a = { ...FICHEROS, "/src/App.tsx": FICHEROS["/src/App.tsx"]!.replace("Guardar", "Uno") };
    const b = { ...FICHEROS, "/src/App.tsx": FICHEROS["/src/App.tsx"]!.replace("Guardar", "Dos") };
    const [ra, rb, ra2] = await Promise.all([
      bundleApp({ carpeta: a, app: APP, modo: "produccion" }),
      bundleApp({ carpeta: b, app: APP, modo: "produccion" }),
      bundleApp({ carpeta: a, app: APP, modo: "produccion" }),
    ]);
    if (!ra?.ok || !rb?.ok) throw new Error("no empaquetó");
    expect(ra.js).toContain("Uno");
    expect(rb.js).toContain("Dos");
    expect(ra2).toBe(ra);
  }, 90_000);

  it("🔴 si el hilo no contesta a tiempo: null, y la siguiente funciona (Review Focus 3)", async () => {
    const carpeta = { ...FICHEROS, "/src/X.ts": "export const x = 1;" };
    expect(await bundleApp({ carpeta, app: APP, modo: "desarrollo", timeoutMs: 1 })).toBeNull();
    expect((await bundleApp({ carpeta: { ...carpeta, "/src/X.ts": "export const x = 2;" }, app: APP, modo: "desarrollo" }))?.ok).toBe(true);
  }, 60_000);

  it("🔴 el hilo usa la build de navegador de esbuild-wasm (la de Node CREA UN PROCESO) y cierra child_process", () => {
    const fuente = readFileSync(path.join(process.cwd(), "lib", "apps", "bundler", "bundler-worker.mjs"), "utf8");
    expect(fuente).toContain('"esbuild-wasm/lib/browser.js"');
    expect(fuente).not.toMatch(/require\(\s*["']esbuild-wasm["']\s*\)|from\s*["']esbuild(?:-wasm)?["']/);
    expect(fuente).toMatch(/syncBuiltinESMExports\(\)/);
  });
});
