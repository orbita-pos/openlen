// @vitest-environment node
// El comprobador de tipos y lint de las apps (plan 03, tarea 2): las
// herramientas REALES sobre ficheros en memoria, con la configuración de la
// plantilla de Lovable.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkApp, formatStylish, formatTsc, type CheckDiagnostic } from "./checker-core.mjs";
import { esqueletoDeApp } from "../esqueleto";
import { FICHEROS as APP_SHADCN } from "../shadcn-fixture";

const RAIZ = join(import.meta.dirname, "..", "..", "..");
const TIPOS = JSON.parse(readFileSync(join(RAIZ, "public", "app-vendor", "2026-11", "types.json"), "utf8")) as Record<string, string>;
const revisar = (files: Record<string, string>) => checkApp({ files, typesPack: TIPOS });

describe("TypeScript", () => {
  it("un prop con el tipo que no es, a través del alias @/", () => {
    const r = revisar({
      "/src/App.tsx": 'import { Boton } from "@/components/Boton";\nexport default function App() {\n  return <Boton etiqueta={3} />;\n}',
      "/src/components/Boton.tsx": "export function Boton(p: { etiqueta: string }) { return <button>{p.etiqueta}</button>; }",
    });
    expect(r.typescript).toHaveLength(1);
    expect(r.typescript[0]).toMatchObject({ ruta: "/src/App.tsx", linea: 3, gravedad: "Error", codigo: "TS2322", fuente: "typescript" });
  });

  it("los tipos del catálogo: un prop que el Dialog de Radix no tiene", () => {
    const r = revisar({ "/src/A.tsx": 'import * as Dialog from "@radix-ui/react-dialog";\nexport const A = () => <Dialog.Root abierto />;' });
    expect(r.typescript.map((d) => d.codigo)).toEqual(["TS2322"]);
  });

  it("lax como Lovable: sin `any` implícito ni variables sin usar como error; los .jsx no se comprueban (checkJs: false)", () => {
    const r = revisar({
      "/src/a.ts": "export function f(x) { const y = 1; return x; }",
      "/src/B.jsx": "export const B = () => <b>{noExiste.campo}</b>;",
    });
    expect(r.typescript).toEqual([]);
  });

  it("import.meta.env, un .css y un .json, como en nuestras apps", () => {
    const r = revisar({
      "/src/main.tsx": 'import "./index.css";\nimport datos from "./datos.json";\nconst url: string = import.meta.env.VITE_SUPABASE_URL;\nexport { url, datos };',
      "/src/index.css": "body{}",
      "/src/datos.json": '{"a":1}',
    });
    expect(r.typescript).toEqual([]);
  });
});

describe("ESLint", () => {
  it("🔴 rules-of-hooks es un error y exhaustive-deps un aviso, también en .jsx", () => {
    const r = revisar({
      "/src/A.jsx": 'import { useState, useEffect } from "react";\nexport function A({ x }) {\n  if (x) { useState(0); }\n  useEffect(() => { console.log(x); }, []);\n  return <b />;\n}',
    });
    expect(r.eslint.map((d) => [d.codigo, d.linea, d.gravedad])).toEqual([
      ["react-hooks/rules-of-hooks", 3, "Error"],
      ["react-hooks/exhaustive-deps", 4, "Warning"],
    ]);
  });

  it("sintaxis moderna en .jsx no rompe el parser (??=, top-level await)", () => {
    const r = revisar({ "/src/a.jsx": "let a; a ??= 1;\nawait Promise.resolve();\nexport default a;" });
    expect(r.eslint).toEqual([]);
  });
});

describe("🔴 una app correcta da CERO diagnósticos (Review Focus 1)", () => {
  it("la app shadcn de la prueba de punta a punta del plan 01", () => {
    const r = revisar(APP_SHADCN);
    expect([...r.typescript, ...r.eslint]).toEqual([]);
  });

  it("el esqueleto con el que nace una app", () => {
    const r = revisar({ ...esqueletoDeApp({ titulo: "Caja", idioma: "es" }).ficheros });
    expect([...r.typescript, ...r.eslint]).toEqual([]);
  });
});

describe("las pruebas de una app (plan 04, tarea 9)", () => {
  const RUTA_DEL_KIT = join(RAIZ, "public", "app-vendor", "test-kit-2026-10", "types.json");
  const kit = () => JSON.parse(readFileSync(RUTA_DEL_KIT, "utf8")) as Record<string, string>;

  it("🔴 una prueba con vitest y Testing Library no da errores de tipos ni de lint", () => {
    const r = checkApp({
      files: {
        "/src/App.tsx": "export default function App() { return <p>Hola</p>; }",
        "/src/App.test.tsx": [
          'import { describe, it, expect, vi } from "vitest";',
          'import { render, screen } from "@testing-library/react";',
          'import userEvent from "@testing-library/user-event";',
          'import App from "./App";',
          'describe("App", () => {',
          '  it("saluda", async () => {',
          "    const f = vi.fn<(n: number) => void>();",
          "    render(<App />);",
          '    await userEvent.setup().click(screen.getByText("Hola"));',
          '    expect(screen.getByText("Hola")).toBeInTheDocument();',
          "    expect(f).not.toHaveBeenCalled();",
          "  });",
          "});",
        ].join("\n"),
        "/src/globales.test.ts": 'describe("g", () => { it("x", () => { expect(1).toBe(1); }); });',
      },
      typesPack: { ...TIPOS, ...kit() },
    });
    expect(r.typescript).toEqual([]);
    expect(r.eslint.filter((d) => d.gravedad === "Error")).toEqual([]);
  });

  it("🔴 y un matcher mal escrito SÍ es un error de tipos", () => {
    const r = checkApp({
      files: { "/src/a.test.ts": 'import { it, expect } from "vitest";\nit("x", () => { expect(document.body).toBeInTheDocumen(); });' },
      typesPack: { ...TIPOS, ...kit() },
    });
    expect(r.typescript.map((d) => d.codigo)).toContain("TS2551");
  });

  it("🔴 el vite.config / vitest.config no es de la app (como el tsconfig.node.json de Lovable): sin falsos «Cannot find module»", () => {
    const r = checkApp({
      files: {
        "/vitest.config.ts": 'import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { setupFiles: ["./src/setup.ts"] } });',
        "/vite.config.ts": 'import react from "@vitejs/plugin-react";\nexport default { plugins: [react()] };',
      },
      typesPack: { ...TIPOS, ...kit() },
    });
    expect(r.typescript).toEqual([]);
  });

  it("los tipos de React los pone el catálogo: el kit no los trae (no pisa los suyos)", () => {
    expect(Object.keys(kit()).filter((f) => /^\/node_modules\/(@types\/react|react|react-dom|csstype)\//.test(f))).toEqual([]);
  });

  it("los globales de vitest, sólo en las pruebas: en un fuente de la app `describe` sigue sin existir", () => {
    const r = checkApp({ files: { "/src/a.ts": "export const x = typeof describe;" }, typesPack: { ...TIPOS, ...kit() } });
    expect(r.eslint.map((d) => d.codigo)).toEqual([]);
    const l = checkApp({ files: { "/src/b.jsx": "export const y = () => expect(1);" }, typesPack: { ...TIPOS, ...kit() } });
    expect(l.eslint.map((d) => d.codigo)).toEqual(["no-undef"]);
  });
});

describe("las salidas, como las herramientas de verdad", () => {
  const d = (x: Partial<CheckDiagnostic>): CheckDiagnostic => ({
    ruta: "/src/App.tsx",
    linea: 5,
    columna: 17,
    gravedad: "Error",
    mensaje: "Type 'number' is not assignable to type 'string'.",
    codigo: "TS2322",
    fuente: "typescript",
    ...x,
  });

  it("formatTsc: una línea por error, sin resumen (tsc sin TTY)", () => {
    expect(formatTsc([d({})])).toBe("src/App.tsx(5,17): error TS2322: Type 'number' is not assignable to type 'string'.\n");
    expect(formatTsc([])).toBe("");
  });

  it("formatStylish: por fichero, y el total al final", () => {
    const s = formatStylish([
      d({ fuente: "eslint", codigo: "react-hooks/rules-of-hooks", mensaje: 'React Hook "useState" is called conditionally.', linea: 3, columna: 9 }),
      d({ fuente: "eslint", gravedad: "Warning", codigo: "react-hooks/exhaustive-deps", mensaje: "React Hook useEffect has a missing dependency: 'x'.", linea: 4, columna: 6 }),
    ]);
    expect(s).toContain("/src/App.tsx\n");
    expect(s).toMatch(/ {2}3:9 +error +React Hook "useState" is called conditionally\. +react-hooks\/rules-of-hooks/);
    expect(s).toMatch(/\n✖ 2 problems \(1 error, 1 warning\)\n$/);
    expect(formatStylish([])).toBe("");
  });
});
