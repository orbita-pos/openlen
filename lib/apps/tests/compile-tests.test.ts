// @vitest-environment node
// Una prueba compilada (plan 04, tarea 3): vitest y Testing Library por su
// nombre, vi.mock izado como en vitest y las LÍNEAS intactas.
import { describe, expect, it } from "vitest";
import { compilarCarpeta } from "@/lib/apps/compilador";
import { compileTestFile, hoistedStatements } from "./compile-tests";
import { isTestFile, isTestSupportFile, setupFilesOf } from "./test-files";

const CATALOGO = "2026-11";
const CARPETA = {
  "/src/main.jsx": 'import App from "./App";',
  "/src/App.jsx": 'import { cargar } from "./lib/datos";\nexport default function App() { return null; }\nexport const X = 1;',
  "/src/lib/datos.ts": "export async function cargar() { return []; }\nexport const NOMBRE = 'real';",
  "/src/lib/todo.ts": 'export * from "./datos";',
};
const ctx = (extra: Record<string, string> = {}) => ({ carpeta: { ...CARPETA, ...extra }, catalogo: CATALOGO });
const lineas = (s: string) => s.split("\n").length;

describe("qué es una prueba", () => {
  it("🔴 el include de vitest, también fuera de /src (Review Focus 5)", () => {
    for (const r of ["/src/App.test.tsx", "/src/a/b.spec.ts", "/tests/Carrito.test.tsx", "/src/x.test.mjs"]) expect(isTestFile(r), r).toBe(true);
    for (const r of ["/src/App.tsx", "/src/testing.ts", "/src/test/setup.ts"]) expect(isTestFile(r), r).toBe(false);
  });

  it("los de configuración: el setupFiles del vite.config, o los de costumbre", () => {
    expect(setupFilesOf({ "/src/test/setup.ts": "" })).toEqual(["/src/test/setup.ts"]);
    expect(setupFilesOf({ "/vite.config.ts": 'test: { setupFiles: ["./src/pruebas/prep.ts"] }', "/src/pruebas/prep.ts": "" })).toEqual(["/src/pruebas/prep.ts"]);
    expect(isTestSupportFile("/src/setupTests.js", { "/src/setupTests.js": "" })).toBe(true);
  });
});

describe("compileTestFile", () => {
  it("🔴 vitest y Testing Library por su nombre; el resto sigue siendo del catálogo o de la carpeta", () => {
    const r = compileTestFile("/src/App.test.jsx", 'import { it } from "vitest";\nimport { render } from "@testing-library/react";\nimport App from "./App";\nit("x", () => render(<App />));', ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.js).toContain('from "vitest"');
    expect(r.js).toContain('from "/src/App.jsx"');
    const mal = compileTestFile("/src/a.test.js", 'import axios from "axios";', ctx());
    expect(mal.ok).toBe(false);
  });

  it("🔴 vi.mock y vi.hoisted: fuera del módulo, dentro de la parte izada, con la ruta resuelta; las LÍNEAS iguales", () => {
    const fuente = [
      'import { it, expect, vi } from "vitest";',
      'import App from "./App";',
      "const { falso } = vi.hoisted(() => ({",
      "  falso: vi.fn(),",
      "}));",
      'vi.mock("./lib/datos", () => ({ cargar: falso, NOMBRE: "x" }));',
      'it("x", () => expect(App).toBeTruthy());',
    ].join("\n");
    const r = compileTestFile("/src/App.test.jsx", fuente, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(lineas(r.js)).toBe(lineas(fuente));
    expect(lineas(r.hoist)).toBe(lineas(fuente));
    expect(r.js).not.toContain("vi.mock(");
    expect(r.js).toContain("globalThis.__openlenHoisted[0]");
    expect(r.hoist).toContain('vi.mock("/src/lib/datos.ts"');
    expect(r.hoist).toContain("globalThis.__openlenHoisted[0] = vi.hoisted(");
    expect(r.hoist).toContain('from "vitest"');
    expect(r.hoist).not.toContain("/src/App.jsx");
    expect(r.mocks).toEqual([{ id: "/src/lib/datos.ts", exports: ["NOMBRE", "cargar"], hasDefault: false }]);
  });

  it("vi.mock de un paquete del catálogo: sus nombres de exportaciones.json", () => {
    const r = compileTestFile("/src/a.test.js", 'import { vi } from "vitest";\nvi.mock("zod", () => ({ z: {} }));', ctx());
    expect(r.ok && r.mocks[0]?.id).toBe("zod");
    expect(r.ok && r.mocks[0]?.exports).toContain("z");
  });

  it("🔴 los bordes de vi.mock, con su línea (Review Focus 3)", () => {
    const dentro = compileTestFile("/src/a.test.js", 'import { vi, describe } from "vitest";\ndescribe("g", () => {\n  vi.mock("./lib/datos");\n});', ctx());
    expect(dentro).toEqual({ ok: false, errores: [expect.objectContaining({ ruta: "/src/a.test.js", linea: 3, mensaje: expect.stringMatching(/vi\.mock must be at the top level of the test file/) })] });
    const estrella = compileTestFile("/src/a.test.js", 'import { vi } from "vitest";\nvi.mock("./lib/todo");', ctx());
    expect(estrella.ok).toBe(false);
    expect(!estrella.ok && estrella.errores[0]!.mensaje).toMatch(/export \*/);
    const noExiste = compileTestFile("/src/a.test.js", 'import { vi } from "vitest";\nvi.mock("./lib/nada");', ctx());
    expect(!noExiste.ok && noExiste.errores[0]).toMatchObject({ linea: 2 });
    const kit = compileTestFile("/src/a.test.js", 'import { vi } from "vitest";\nvi.mock("@testing-library/react");', ctx());
    expect(kit.ok).toBe(false);
  });

  it("hoistedStatements: paréntesis dentro de cadenas, plantillas y comentarios no lo engañan", () => {
    const js = 'vi.mock("/a", () => ({ s: ")", t: `)${1})`, /* ) */ }));\nconst x = 1;';
    const [h] = hoistedStatements(js);
    expect(js.slice(h!.start, h!.end)).toBe('vi.mock("/a", () => ({ s: ")", t: `)${1})`, /* ) */ }));');
  });
});

describe("las pruebas no son de la app", () => {
  it("🔴 compilarCarpeta las deja fuera en una app (no son del catálogo, y no se publican), y los de configuración también", () => {
    const r = compilarCarpeta({
      carpeta: { ...CARPETA, "/src/App.test.jsx": 'import { it } from "vitest";', "/src/test/setup.ts": 'import "@testing-library/jest-dom";' },
      catalogo: CATALOGO,
    });
    expect(r.errores).toEqual([]);
    expect(Object.keys(r.ficheros)).not.toContain("/src/App.test.jsx");
    expect(Object.keys(r.ficheros)).not.toContain("/src/test/setup.ts");
  });
});
