// @vitest-environment node
// Las pruebas de una app, corridas de verdad en el Chromium de los ojos
// (plan 04, tarea 5): una página por fichero, con el guardia SSRF.
import { afterAll, describe, expect, it } from "vitest";
import { stopBundlerWorker } from "@/lib/apps/bundler/bundle-app";
import { FICHEROS } from "@/lib/apps/shadcn-fixture";
import { findTestFiles, runAppTests } from "./run-tests";

afterAll(() => stopBundlerWorker());
const APP = { catalogo: "2026-11", entrada: "/src/main.jsx" } as const;
const estados = (r: Awaited<ReturnType<typeof runAppTests>>) =>
  r!.files.flatMap((f) => [f.fileError ? `${f.file}: FILE ${f.fileError.message.split("\n")[0]}` : null, ...f.tests.map((t) => `${f.file}: ${t.state} ${t.name.join(" > ")}`)].filter(Boolean));

describe("findTestFiles", () => {
  it("el include de vitest, y los filtros como `vitest run carrito`", () => {
    const c = { "/src/a.test.tsx": "", "/tests/Carrito.test.tsx": "", "/src/App.tsx": "" };
    expect(findTestFiles(c, [])).toEqual(["/src/a.test.tsx", "/tests/Carrito.test.tsx"]);
    expect(findTestFiles(c, ["carrito"])).toEqual(["/tests/Carrito.test.tsx"]);
  });
});

describe("runAppTests", () => {
  it("🔴 la app de shadcn: una prueba de componente con Testing Library pasa, y su brazo de control falla con su línea", async () => {
    const r = await runAppTests({
      carpeta: {
        ...FICHEROS,
        "/src/App.test.jsx": [
          'import { describe, it, expect } from "vitest";',
          'import { render, screen } from "@testing-library/react";',
          'import App from "./App";',
          'describe("App", () => {',
          '  it("pinta Guardar", () => { render(<App />); expect(screen.getByText("Guardar")).toBeInTheDocument(); });',
          '  it("CONTROL", () => {',
          '    expect(1 + 2).toBe(4);',
          "  });",
          "});",
        ].join("\n"),
      },
      app: APP,
    });
    expect(estados(r)).toEqual(["/src/App.test.jsx: pass App > pinta Guardar", "/src/App.test.jsx: fail App > CONTROL"]);
    expect(r!.files[0]!.tests[1]!.error!.site).toEqual({ ruta: "/src/App.test.jsx", linea: 7, columna: 19 });
  }, 120_000);

  it("🔴 vi.mock de un módulo de la app, de punta a punta", async () => {
    const r = await runAppTests({
      carpeta: {
        "/src/main.jsx": 'import App from "./App";',
        "/src/lib/datos.js": 'export async function cargar() { throw new Error("REAL"); }',
        "/src/Lista.jsx": 'import { useEffect, useState } from "react";\nimport { cargar } from "./lib/datos";\nexport default function Lista() { const [xs, setXs] = useState([]); useEffect(() => { cargar().then(setXs); }, []); return <ul>{xs.map((x) => <li key={x}>{x}</li>)}</ul>; }',
        "/src/App.jsx": "export default function App() { return null; }",
        "/src/Lista.test.jsx": [
          'import { it, expect, vi } from "vitest";',
          'import { render, screen } from "@testing-library/react";',
          'import Lista from "./Lista";',
          'vi.mock("./lib/datos", () => ({ cargar: vi.fn(async () => ["café", "té"]) }));',
          'it("pinta lo simulado", async () => { render(<Lista />); expect(await screen.findByText("té")).toBeInTheDocument(); });',
        ].join("\n"),
      },
      app: APP,
    });
    expect(estados(r)).toEqual(["/src/Lista.test.jsx: pass pinta lo simulado"]);
  }, 120_000);

  it("🔴 un fichero que bloquea la página: falla él, el siguiente corre, y todo cabe en el plazo (Review Focus 1)", async () => {
    const t0 = Date.now();
    const r = await runAppTests({
      carpeta: {
        "/src/main.jsx": "",
        "/src/a.test.js": 'import { it } from "vitest";\nit("bloquea", () => { while (true) {} });',
        "/src/b.test.js": 'import { it, expect } from "vitest";\nit("sigue", () => expect(1).toBe(1));',
      },
      app: APP,
      perFileMs: 4_000,
    });
    expect(estados(r)).toEqual(["/src/a.test.js: FILE didn't finish in 4s: a test blocked the page (an endless loop?).", "/src/b.test.js: pass sigue"]);
    expect(Date.now() - t0).toBeLessThan(25_000);
  }, 60_000);

  it("🔴 una prueba que pide una dirección interna: el guardia de los ojos la corta, falla en el acto y se dice (Review Focus 4)", async () => {
    // La red pública sí sale, como en los ojos (`view_page`) y como en vitest:
    // el guardia sólo corta lo privado o interno (SSRF).
    const r = await runAppTests({
      carpeta: {
        "/src/main.jsx": "",
        "/src/red.test.js": 'import { it, expect } from "vitest";\nit("dentro", async () => { await expect(fetch("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(); });',
      },
      app: APP,
    });
    expect(estados(r)).toEqual(["/src/red.test.js: pass dentro"]);
    expect(r!.blocked).toContain("http://169.254.169.254/latest/meta-data/");
  }, 60_000);

  it("sin pruebas: ningún fichero", async () => {
    expect((await runAppTests({ carpeta: { "/src/main.jsx": "" }, app: APP }))!.files).toEqual([]);
  });
});
