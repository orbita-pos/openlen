// @vitest-environment node
//
// LO QUE VIAJA AL IFRAME NO PUEDE LLEVAR UNA FUNCIÓN CON NOMBRE DENTRO.
//
// Los inyectores no importan su lógica en la página: la serializan con
// `.toString()` dentro de `CORE_SRC`. `edit-path.ts` ya avisa de que esas
// funciones tienen que ser autosuficientes —sin closures, sin imports—. Falta
// una línea en ese aviso, y costó una tarde el 19/09/2026:
//
//   esbuild con `keepNames` envuelve toda función interna CON NOMBRE en
//   `__name(fn, "nombre")` —la declarada también, con la llamada detrás— y ese
//   envoltorio viaja dentro del `.toString()` hasta la página, donde `__name`
//   no existe. La llamada revienta, el código no corre, y no se entera nadie:
//   pasa dentro del iframe.
//
// Lo que NO rompe: una función anónima pasada en línea (`list.sort(function
// (a, b) {…})`). Esa no recibe nombre, así que no se envuelve. Por eso la
// guarda busca funciones CON NOMBRE y no «cualquier function», que marcaría
// `rectsToRows` sin motivo.
//
// POR QUÉ NO ES UNA PRUEBA DE NAVEGADOR: bajo vitest no aparece `__name`
// (su transform no lleva `keepNames`) y bajo el build real tampoco (SWC). El
// que sí lo pone es **tsx**, que es con lo que corren los arneses de
// `.claude/qa` y `npm run test:node`. O sea: el navegador no discrimina esto
// nunca, y una sonda que lo intentara pasaría en verde con el fallo puesto.
// Medido: con un `const una = function () {}` dentro de `trasCargar`, las tres
// pruebas de geometría de `encaje-al-reemplazar.browser.test.ts` seguían
// verdes mientras el ajuste no corría.
//
// LA LISTA NO SE ESCRIBE A MANO. Se lee de los propios inyectores, así que una
// función nueva serializada mañana entra sola — y si su módulo no está aquí, la
// guarda cae en vez de ignorarla.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import * as core from "./inline-edit-core";
import * as designStash from "./design-stash";
import * as dropPlace from "./drop-place-core";
import * as editPath from "./edit-path";
import * as encaje from "./encaje-en-el-marco";
import * as ghost from "@/lib/workspace-v2/inline-edit/ghost-sibling-layout";
import * as transform from "@/lib/workspace-v2/inline-edit/transform-composition";

const MODULOS: Record<string, unknown>[] = [
  core,
  designStash,
  dropPlace,
  editPath,
  encaje,
  ghost,
  transform,
];

const DIR = join(process.cwd(), "components", "workspace-v2");

/** Los nombres que los inyectores serializan: `${loQueSea.toString()}`. */
function nombresSerializados(): string[] {
  const fuera = new Set<string>();
  for (const f of readdirSync(DIR)) {
    if (!f.startsWith("use-") || !f.endsWith(".ts") || f.includes(".test.")) continue;
    const src = readFileSync(join(DIR, f), "utf8");
    for (const m of src.matchAll(/\$\{([A-Za-z_$][\w$]*)\.toString\(\)\}/g)) {
      fuera.add(m[1]!);
    }
  }
  return [...fuera].sort();
}

function resolver(nombre: string): unknown {
  for (const m of MODULOS) {
    const fn = (m as Record<string, unknown>)[nombre];
    if (typeof fn === "function") return fn;
  }
  return undefined;
}

/** Quita cadenas y comentarios: `typeof x === "function"` no es una función. */
function sinTexto(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

const CON_NOMBRE: Array<[string, RegExp]> = [
  ["function nombre() {}", /\bfunction\s+[A-Za-z_$]/],
  ["var nombre = function", /\b(?:var|let|const)\s+[A-Za-z_$][\w$]*\s*=\s*function\b/],
  [
    "var nombre = () =>",
    /\b(?:var|let|const)\s+[A-Za-z_$][\w$]*\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
  ],
];

const NOMBRES = nombresSerializados();

describe("el codigo que se serializa al iframe", () => {
  it("la lista se lee de los inyectores y no esta vacia", () => {
    // Si el patrón de inyección cambia, esta guarda dejaría de mirar nada y
    // pasaría en verde para siempre. Que se entere.
    expect(NOMBRES.length).toBeGreaterThan(20);
  });

  for (const nombre of NOMBRES) {
    it(`${nombre} no lleva una funcion con nombre dentro`, () => {
      const fn = resolver(nombre);
      expect(
        typeof fn,
        `${nombre} se serializa pero no se exporta desde ningun modulo conocido — anadelo a MODULOS`,
      ).toBe("function");
      const src = (fn as () => unknown).toString();
      const cuerpo = sinTexto(src).slice(src.indexOf("{"));
      const culpable = CON_NOMBRE.find(([, re]) => re.test(cuerpo));
      expect(
        culpable ? culpable[0] : null,
        `${nombre} lleva una funcion con nombre dentro; esbuild la envolveria en __name() y la pagina reventaria:\n${src}`,
      ).toBeNull();
      expect(src, `${nombre} ya viaja con un envoltorio __name()`).not.toContain("__name");
    });
  }
});
