// @vitest-environment node
// Las pruebas empaquetadas (plan 04, tarea 4): con el esbuild-wasm del plan
// 02, una entrada por fichero y sin `splitting` (con él, el simulado se
// evaluaba ANTES que su vi.mock: medido).
import { afterAll, describe, expect, it } from "vitest";
import { stopBundlerWorker } from "@/lib/apps/bundler/bundle-app";
import { serializeEsmLock, type LockedPackage } from "@/lib/apps/npm/lock";
import { ESM_LOCK_PATH, PACKAGE_JSON_PATH } from "@/lib/apps/npm/paths";
import { __setModuleStoreForTest, memoryStore, sha256Hex } from "@/lib/apps/npm/store";
import { bundleAppTests, TESTS_PREFIX } from "./bundle-tests";

afterAll(() => stopBundlerWorker());
const APP = { catalogo: "2026-11", entrada: "/src/main.jsx" } as const;
const CARPETA = {
  "/src/main.jsx": 'import { createRoot } from "react-dom/client";\nimport App from "./App";\ncreateRoot(document.getElementById("root")).render(<App />);',
  "/src/App.jsx": 'import { NOMBRE } from "./lib/datos";\nexport default function App() { return <p>{NOMBRE}</p>; }',
  "/src/lib/datos.js": 'export const NOMBRE = "real";',
  "/src/suma.js": "export const suma = (a, b) => a + b;",
};

describe("bundleAppTests", () => {
  it("🔴 una entrada por fichero, con React y el kit dentro, y su mapa", async () => {
    const r = await bundleAppTests({
      carpeta: {
        ...CARPETA,
        "/src/App.test.jsx": 'import { it, expect } from "vitest";\nimport { render, screen } from "@testing-library/react";\nimport App from "./App";\nit("x", () => { render(<App />); expect(screen.getByText("real")).toBeInTheDocument(); });',
        "/src/suma.test.js": 'import { it, expect } from "vitest";\nimport { suma } from "./suma";\nit("s", () => expect(suma(1, 2)).toBe(3));',
      },
      app: APP,
      testFiles: ["/src/App.test.jsx", "/src/suma.test.js"],
    });
    expect(r!.failed).toEqual([]);
    expect(Object.keys(r!.entries).sort()).toEqual(["/src/App.test.jsx", "/src/suma.test.js"]);
    for (const e of Object.values(r!.entries)) {
      expect(e.startsWith(TESTS_PREFIX)).toBe(true);
      expect(r!.files[e]).toBeTruthy();
      expect(r!.maps[e]).toBeTruthy();
    }
    expect(Object.keys(r!.files).some((k) => /chunk-/.test(k))).toBe(false);
  }, 60_000);

  it("🔴 un fichero que no compila falla SOLO; los demás se empaquetan (Review Focus 2)", async () => {
    const r = await bundleAppTests({
      carpeta: { ...CARPETA, "/src/roto.test.js": 'import { it } from "vitest";\nit("x", () => { <div });', "/src/suma.test.js": 'import { it } from "vitest";\nimport { suma } from "./suma";\nit("s", () => suma);' },
      app: APP,
      testFiles: ["/src/roto.test.js", "/src/suma.test.js"],
    });
    expect(r!.failed.map((f) => f.file)).toEqual(["/src/roto.test.js"]);
    expect(r!.failed[0]!.errores[0]).toMatchObject({ ruta: "/src/roto.test.js", linea: 2 });
    expect(Object.keys(r!.entries)).toEqual(["/src/suma.test.js"]);
  }, 60_000);

  it("🔴 un módulo de la app que no compila: fallan las pruebas que lo alcanzan, no las demás (Review Focus 2)", async () => {
    const r = await bundleAppTests({
      carpeta: {
        ...CARPETA,
        "/src/lib/datos.js": "export const NOMBRE = <;",
        "/src/App.test.jsx": 'import { it } from "vitest";\nimport App from "./App";\nit("x", () => App);',
        "/src/suma.test.js": 'import { it } from "vitest";\nimport { suma } from "./suma";\nit("s", () => suma);',
      },
      app: APP,
      testFiles: ["/src/App.test.jsx", "/src/suma.test.js"],
    });
    expect(r!.failed.map((f) => f.file)).toEqual(["/src/App.test.jsx"]);
    expect(r!.failed[0]!.errores[0]!.ruta).toBe("/src/lib/datos.js");
    expect(Object.keys(r!.entries)).toEqual(["/src/suma.test.js"]);
  }, 60_000);

  it("🔴 un error de esbuild en un fichero (un nombre que el módulo no exporta) lo hace fallar SOLO; los demás se empaquetan", async () => {
    const r = await bundleAppTests({
      carpeta: {
        ...CARPETA,
        "/src/iva.test.js": 'import { it } from "vitest";\nimport { conIva } from "./suma";\nit("i", () => conIva);',
        "/src/suma.test.js": 'import { it } from "vitest";\nimport { suma } from "./suma";\nit("s", () => suma);',
      },
      app: APP,
      testFiles: ["/src/iva.test.js", "/src/suma.test.js"],
    });
    expect(r!.failed.map((f) => f.file)).toEqual(["/src/iva.test.js"]);
    expect(r!.failed[0]!.errores[0]).toMatchObject({ ruta: "/src/iva.test.js", linea: 2 });
    // Sin el espacio de nombres del empaquetador: la ruta, como la escribió.
    expect(r!.failed[0]!.errores[0]!.mensaje).toContain('"/src/suma.js"');
    expect(r!.failed[0]!.errores[0]!.mensaje).not.toContain("app:");
    expect(Object.keys(r!.entries)).toEqual(["/src/suma.test.js"]);
    expect(r!.files[r!.entries["/src/suma.test.js"]!]).toBeTruthy();
  }, 60_000);

  it("🔴 un error de esbuild en un módulo de la app: fallan las pruebas que lo alcanzan, no las demás", async () => {
    // Tras un `export *` el compilador no sabe la lista entera: lo ve esbuild.
    const r = await bundleAppTests({
      carpeta: {
        ...CARPETA,
        "/src/lib/todo.js": 'export * from "./datos";',
        "/src/App.jsx": 'import { APELLIDO } from "./lib/todo";\nexport default function App() { return <p>{APELLIDO}</p>; }',
        "/src/App.test.jsx": 'import { it } from "vitest";\nimport App from "./App";\nit("x", () => App);',
        "/src/suma.test.js": 'import { it } from "vitest";\nimport { suma } from "./suma";\nit("s", () => suma);',
      },
      app: APP,
      testFiles: ["/src/App.test.jsx", "/src/suma.test.js"],
    });
    expect(r!.failed.map((f) => f.file)).toEqual(["/src/App.test.jsx"]);
    expect(r!.failed[0]!.errores[0]!.ruta).toBe("/src/App.jsx");
    expect(Object.keys(r!.entries)).toEqual(["/src/suma.test.js"]);
    expect(r!.files[r!.entries["/src/suma.test.js"]!]).toBeTruthy();
  }, 60_000);

  it("🔴 vi.mock: el módulo simulado pide su fábrica, y el real sigue dentro para importOriginal", async () => {
    const r = await bundleAppTests({
      carpeta: { ...CARPETA, "/src/App.test.jsx": 'import { it, vi } from "vitest";\nimport App from "./App";\nvi.mock("./lib/datos", () => ({ NOMBRE: "falso" }));\nit("x", () => App);' },
      app: APP,
      testFiles: ["/src/App.test.jsx"],
    });
    const js = r!.files[r!.entries["/src/App.test.jsx"]!]!;
    expect(js).toContain("__mockedModule");
    expect(js).toContain('"real"');
  }, 60_000);

  it("🔴 npm abierto: una prueba que importa un paquete del lock se empaqueta con él (los mismos paquetes que la app)", async () => {
    const code = 'export default function tiny() { return "tiny-from-esm"; }';
    const url = "https://esm.sh/tiny@1.0.0/x.mjs";
    const set = { entry: url, modules: { [url]: sha256Hex(code) } };
    const tiny: LockedPackage = {
      version: "1.0.0", publishedAt: "2026-01-01T00:00:00.000Z", externals: [], development: { "": set }, production: { "": set },
      assets: {}, types: null, warnings: [], bytes: code.length,
    };
    const store = memoryStore();
    await store.put(sha256Hex(code), code);
    __setModuleStoreForTest(store);
    try {
      const r = await bundleAppTests({
        carpeta: {
          ...CARPETA,
          [PACKAGE_JSON_PATH]: JSON.stringify({ dependencies: { tiny: "^1.0.0" } }),
          [ESM_LOCK_PATH]: serializeEsmLock({ lockfileVersion: 1, packages: { tiny } }),
          "/src/tiny.test.js": 'import { it, expect } from "vitest";\nimport tiny from "tiny";\nit("t", () => expect(tiny()).toBe("tiny-from-esm"));',
        },
        app: APP,
        testFiles: ["/src/tiny.test.js"],
      });
      expect(r!.failed).toEqual([]);
      expect(r!.files[r!.entries["/src/tiny.test.js"]!]).toContain("tiny-from-esm");
    } finally {
      __setModuleStoreForTest(null);
    }
  }, 60_000);
});
