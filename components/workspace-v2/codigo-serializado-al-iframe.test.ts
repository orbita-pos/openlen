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
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { decl } from "./serializar-al-iframe";

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

/** Los nombres que los inyectores serializan: `decl("loQueSea", loQueSea)`. */
function nombresSerializados(): string[] {
  const fuera = new Set<string>();
  for (const f of readdirSync(DIR)) {
    if (!f.startsWith("use-") || !f.endsWith(".ts") || f.includes(".test.")) continue;
    const src = readFileSync(join(DIR, f), "utf8");
    for (const m of src.matchAll(/\bdecl\(\s*"[^"]+"\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
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

// ── Y EL NOMBRE CON EL QUE SE DECLARA ───────────────────────────────────────
//
// La otra mitad, y ésta sólo aparecía EN PRODUCCIÓN. El minificador renombra la
// función, pero el nombre de la izquierda es una cadena literal de la plantilla
// y no se renombra con ella:
//
//     var isEditorNode = function f$(a){…};
//     var editChildTags = function fY(a){ … f$(c) … };   ← f$ no existe aquí
//
// El nombre de una expresión de función con nombre sólo está ligado dentro de
// ella. Medido en la caja el 2026-09-20 sobre el bundle de produccion:
// `editChildTags` reventaba con ReferenceError en cuanto el elemento tenía
// hijos, y en `postEdicion` esa llamada vive dentro del try del postMessage —
// la edición no se mandaba y no se enteraba nadie.
//
// Bajo vitest NO hay minificación, así que esto no se puede sondear con las
// funciones de verdad: se sondea `decl` con una pareja que imita la forma.

describe("el nombre con el que se declara en la pagina", () => {
  // La forma exacta del bundle: `chico` se llama f$ y `grande` lo llama por ese
  // nombre, como hacen editChildTags -> isEditorNode.
  function f$(x: number) {
    return x > 0;
  }
  function fY(x: number) {
    return f$(x) ? "si" : "no";
  }

  function correr(guion: string): string {
    return runInNewContext(guion + "\nnombreLargo(1)", {}) as string;
  }

  it("decl declara tambien el nombre real, y la llamada cruzada resuelve", () => {
    const guion = [decl("nombreCorto", f$), decl("nombreLargo", fY)].join("\n");
    expect(guion, "no emitio el alias del nombre minificado").toContain("var f$ =");
    expect(correr(guion)).toBe("si");
  });

  it("CONTRA-PRUEBA: sin el alias, la pagina revienta", () => {
    // Lo que se emitia antes del 2026-09-20.
    const viejo = [
      `var nombreCorto = ${f$.toString()};`,
      `var nombreLargo = ${fY.toString()};`,
    ].join("\n");
    expect(() => correr(viejo)).toThrow(/f\$ is not defined/);
  });

  it("sin minificar no cambia nada", () => {
    function suelta() {
      return "ok";
    }
    expect(decl("suelta", suelta)).toBe(`var suelta = ${suelta.toString()};`);
  });

  // Un DATO no tiene `.name`, asi que `decl` no puede aliasarlo: una funcion
  // serializada que lea una constante del modulo revienta igual en produccion.
  // La unica salida es que no la lea. Esto lo vigila por comportamiento.
  it("isEditorNode lleva la lista dentro, y dice lo mismo que EDITOR_NODE_ATTRS", () => {
    const con = (attr: string) =>
      ({ hasAttribute: (a: string) => a === attr }) as unknown as Element;
    for (const attr of editPath.EDITOR_NODE_ATTRS) {
      expect(editPath.isEditorNode(con(attr)), `${attr} deberia contar como nodo del editor`).toBe(
        true,
      );
    }
    // Y no de mas: dos marcas que van sobre contenido REAL del usuario.
    for (const attr of ["data-openlen-editable", "data-openlen-reorder-index"]) {
      expect(editPath.isEditorNode(con(attr)), `${attr} NO es un nodo del editor`).toBe(false);
    }
  });

  it("ninguna funcion serializada lee una constante exportada de su modulo", () => {
    const datos: string[] = [];
    for (const m of MODULOS) {
      for (const [k, v] of Object.entries(m)) {
        if (typeof v !== "function" && k === k.toUpperCase() && k.length > 3) datos.push(k);
      }
    }
    const culpables: string[] = [];
    for (const nombre of NOMBRES) {
      const fn = resolver(nombre);
      if (typeof fn !== "function") continue;
      const src = sinTexto((fn as () => unknown).toString());
      for (const d of datos) {
        if (new RegExp("\\b" + d + "\\b").test(src)) culpables.push(`${nombre} lee ${d}`);
      }
    }
    expect(
      culpables,
      `el minificador renombra la lectura y la plantilla no; copia el dato DENTRO:\n${culpables.join("\n")}`,
    ).toEqual([]);
  });

  it("ningun inyector serializa una funcion sin pasar por decl", () => {
    const crudas: string[] = [];
    for (const f of readdirSync(DIR)) {
      if (!f.startsWith("use-") || !f.endsWith(".ts") || f.includes(".test.")) continue;
      const src = readFileSync(join(DIR, f), "utf8");
      // `var X = ${Y.toString()};` a pelo — lo que rompia en produccion.
      for (const m of src.matchAll(/var\s+[A-Za-z_$][\w$]*\s*=\s*\$\{[A-Za-z_$][\w$]*\.toString\(\)\}/g)) {
        crudas.push(`${f}: ${m[0]}`);
      }
    }
    expect(crudas, `usa decl("<nombre>", <fn>) en su lugar:\n${crudas.join("\n")}`).toEqual([]);
  });
});
