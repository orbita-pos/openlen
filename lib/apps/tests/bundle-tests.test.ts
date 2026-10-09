// @vitest-environment node
// Las pruebas empaquetadas (plan 04, tarea 4): con el esbuild-wasm del plan
// 02, una entrada por fichero y sin `splitting` (con él, el simulado se
// evaluaba ANTES que su vi.mock: medido).
import { afterAll, describe, expect, it } from "vitest";
import { stopBundlerWorker } from "@/lib/apps/bundler/bundle-app";
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
});
