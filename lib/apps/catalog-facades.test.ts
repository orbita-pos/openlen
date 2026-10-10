// @vitest-environment node
// LAS FACHADAS DE REACT EXPORTAN LO QUE SE LES PIDE. En un catálogo, React y
// ReactDOM van en `react-todo.js` y lo demás los toma de sus FACHADAS
// (`react-dom.js`…), que sólo reexportan por nombre. Un paquete que hace
// `import ReactDOM from "react-dom"` (por defecto) no empaqueta: lo vio Len en
// el ensayo de caja del 09/10 con sonner («No matching export … for import
// "default"»), un paquete del catálogo que no se podía usar.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "es-module-lexer/js";
import { describe, expect, it } from "vitest";
import { nombresImportados } from "./compilador";
import EXPORTACIONES from "./exportaciones.json";

const VENDOR = path.join(process.cwd(), "public", "app-vendor");
const FACHADAS = ["react.js", "react-jsx-runtime.js", "react-dom.js", "react-dom-client.js"];

/** `fichero: nombre que pide a la fachada y ésta no exporta`, de un catálogo y un modo. */
function loQueFalta(catalogo: string, modo: string): string[] {
  const dir = path.join(VENDOR, catalogo, modo);
  const exporta = (EXPORTACIONES as Record<string, Record<string, readonly string[]>>)[catalogo]!;
  const falta: string[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".js") && !FACHADAS.includes(x))) {
    const js = readFileSync(path.join(dir, f), "utf8");
    const [imports] = parse(js);
    for (const imp of imports) {
      const fachada = typeof imp.specifier === "string" ? imp.specifier.replace(/^\.\//, "") : "";
      if (imp.type !== "static" || !FACHADAS.includes(fachada)) continue;
      for (const nombre of nombresImportados(js.slice(imp.importStart, imp.importEnd)) ?? []) {
        if (!exporta[fachada]?.includes(nombre)) falta.push(`${f}: "${nombre}" de ${fachada}`);
      }
    }
  }
  return falta;
}

describe("las fachadas de React de cada catálogo", () => {
  for (const catalogo of Object.keys(EXPORTACIONES)) {
    for (const modo of ["desarrollo", "produccion"]) {
      it(`🔴 ${catalogo}/${modo}: ningún fichero pide a una fachada lo que no exporta`, () => {
        expect(loQueFalta(catalogo, modo)).toEqual([]);
      });
    }
  }

  it("BRAZO DE CONTROL: la prueba ve los imports de las fachadas (si no, pasaría sin mirar)", () => {
    const js = readFileSync(path.join(VENDOR, "2026-11", "produccion", "radix-ui.js"), "utf8");
    expect(parse(js)[0].some((i) => typeof i.specifier === "string" && FACHADAS.includes(i.specifier.replace(/^\.\//, "")))).toBe(true);
  });
});
