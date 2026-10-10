// lib/apps/tests/compile-tests.ts — UNA PRUEBA, COMPILADA (plan 04). Con el
// MISMO compilador que la app (invariante 6: la puerta de los diagnósticos),
// dejando pasar por su nombre `vitest` y Testing Library, y con `vi.mock`
// IZADO como lo iza vitest: los `vi.mock(…)` y `vi.hoisted(…)` de nivel
// superior corren ANTES que cualquier import del fichero.
//
// Se parte en dos módulos con las MISMAS líneas que el fuente, para que un
// error diga su línea de verdad (sucrase ya las conserva):
//   · `hoist`: sólo los imports de "vitest" y esas sentencias — el resto en
//     blanco —, con la ruta de cada `vi.mock` resuelta como un import;
//   · `js`: el fichero sin ellas (en blanco) y con cada `vi.hoisted(…)`
//     cambiado por su valor, que la parte izada dejó en
//     `globalThis.__openlenHoisted[i]`.
// El empaquetador (`bundle-tests.ts`) importa primero `hoist` y después `js`,
// y cambia cada módulo de `mocks` por uno que pide su fábrica al runtime.
import { parse } from "es-module-lexer/js";
import {
  catalogExportsOf,
  compilarFuente,
  resolveLocalImport,
  type ContextoDeCompilacion,
  type Diagnostico,
} from "@/lib/apps/compilador";
import { dependenciaDe } from "@/lib/apps/dependencias";
import { TEST_SPECIFIERS } from "./test-kit";

export const ORIGINAL_SUFFIX = "?original";

export interface MockSpec {
  /** Lo que se simula, resuelto: `/src/lib/datos.ts` o un nombre del catálogo (`zod`). */
  readonly id: string;
  /** Lo que exporta por su nombre el módulo real: lo que exportará el simulado. */
  readonly exports: readonly string[];
  readonly hasDefault: boolean;
}

export type CompiledTest =
  | { readonly ok: true; readonly js: string; readonly hoist: string; readonly mocks: readonly MockSpec[] }
  | { readonly ok: false; readonly errores: readonly Diagnostico[] };

export interface HoistedStatement {
  readonly kind: "mock" | "unmock" | "hoisted";
  /** La sentencia entera (con su `;`), y dentro la llamada `vi.xxx(…)`. */
  readonly start: number;
  readonly end: number;
  readonly callStart: number;
  readonly callEnd: number;
  /** En nivel superior (columna 0). Uno sangrado no se puede izar. */
  readonly topLevel: boolean;
}

const INICIO = /^([ \t]*)(?:(?:const|let|var)\s+[^=\n]+=\s*)?(?:await\s+)?vi\.(mock|unmock|hoisted)\(/gm;

/** El final de la llamada que abre el paréntesis en `abre`: cuenta paréntesis,
 *  corchetes y llaves, saltando cadenas, plantillas (con `${…}` dentro) y
 *  comentarios. */
function cierre(js: string, abre: number): number {
  const pila: string[] = [];
  let i = abre;
  const plantillas: number[] = [];
  while (i < js.length) {
    const c = js[i]!;
    if (c === "/" && js[i + 1] === "/") {
      i = js.indexOf("\n", i);
      if (i < 0) return -1;
      continue;
    }
    if (c === "/" && js[i + 1] === "*") {
      i = js.indexOf("*/", i + 2) + 2;
      if (i < 2) return -1;
      continue;
    }
    if (c === '"' || c === "'") {
      i++;
      while (i < js.length && js[i] !== c) i += js[i] === "\\" ? 2 : 1;
      i++;
      continue;
    }
    if (c === "`") {
      i++;
      while (i < js.length && js[i] !== "`") {
        if (js[i] === "\\") i += 2;
        else if (js[i] === "$" && js[i + 1] === "{") {
          plantillas.push(pila.length);
          pila.push("{");
          i += 2;
          break;
        } else i++;
      }
      if (js[i] === "`") i++;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") pila.push(c);
    else if (c === ")" || c === "]" || c === "}") {
      pila.pop();
      if (c === "}" && plantillas.length > 0 && plantillas[plantillas.length - 1] === pila.length) {
        // Vuelve a la plantilla que abrió este `${`.
        plantillas.pop();
        i++;
        while (i < js.length && js[i] !== "`") {
          if (js[i] === "\\") i += 2;
          else if (js[i] === "$" && js[i + 1] === "{") {
            plantillas.push(pila.length);
            pila.push("{");
            i += 2;
            break;
          } else i++;
        }
        if (js[i] === "`") i++;
        continue;
      }
      if (pila.length === 0) return i + 1;
    }
    i++;
  }
  return -1;
}

export function hoistedStatements(js: string): HoistedStatement[] {
  const out: HoistedStatement[] = [];
  for (const m of js.matchAll(INICIO)) {
    const start = m.index + m[1]!.length;
    const abre = m.index + m[0].length - 1;
    const fin = cierre(js, abre);
    if (fin < 0) continue;
    const callStart = js.lastIndexOf("vi.", abre);
    const end = js[fin] === ";" ? fin + 1 : fin;
    out.push({ kind: m[2] as HoistedStatement["kind"], start, end, callStart, callEnd: fin, topLevel: m[1]!.length === 0 });
  }
  return out;
}

const enBlanco = (s: string) => s.replace(/[^\n]/g, " ");
const lineaDe = (js: string, i: number) => js.slice(0, i).split("\n").length;

export function compileTestFile(ruta: string, codigo: string, ctx: ContextoDeCompilacion): CompiledTest {
  const r = compilarFuente(ruta, codigo, { ...ctx, extraSpecifiers: TEST_SPECIFIERS });
  if (!r.ok) return r;
  const js = r.js;
  const izadas = hoistedStatements(js);
  const errores: Diagnostico[] = [];
  const mocks: MockSpec[] = [];
  const cambiosHoist: { start: number; end: number; texto: string }[] = [];
  const cambiosJs: { start: number; end: number; texto: string }[] = [];
  let n = 0;
  for (const h of izadas) {
    const linea = lineaDe(js, h.start);
    if (!h.topLevel) {
      errores.push({ ruta, linea, columna: null, mensaje: `vi.${h.kind} must be at the top level of the test file: vitest hoists it above the imports, so inside a function or a describe it can't work. Move it to the top level.` });
      continue;
    }
    const sentencia = js.slice(h.start, h.end);
    if (h.kind === "hoisted") {
      const i = n++;
      const llamada = js.slice(h.callStart, h.callEnd);
      cambiosHoist.push({ start: h.start, end: h.end, texto: sentencia.replace(llamada, `(globalThis.__openlenHoisted[${i}] = ${llamada})`) });
      const valor = `globalThis.__openlenHoisted[${i}]`;
      // El valor, y los MISMOS saltos de línea que la llamada: las líneas de abajo no se mueven.
      cambiosJs.push({ start: h.callStart, end: h.callEnd, texto: valor + "\n".repeat(llamada.split("\n").length - 1) });
      continue;
    }
    const arg = /^vi\.(?:mock|unmock)\(\s*(["'`])([^"'`]+)\1/.exec(js.slice(h.callStart, h.callEnd));
    if (!arg) {
      errores.push({ ruta, linea, columna: null, mensaje: `vi.${h.kind} needs the module's path as a plain string, like vi.mock("./lib/datos", () => ({ … })).` });
      continue;
    }
    const especificador = arg[2]!;
    const mock = mockSpecOf(especificador, ruta, ctx);
    if ("error" in mock) {
      errores.push({ ruta, linea, columna: null, mensaje: mock.error });
      continue;
    }
    if (h.kind === "mock") mocks.push(mock);
    cambiosHoist.push({ start: h.start, end: h.end, texto: sentencia.replace(arg[0], arg[0].replace(especificador, mock.id)) });
    cambiosJs.push({ start: h.start, end: h.end, texto: enBlanco(sentencia) });
  }
  if (errores.length > 0) return { ok: false, errores };

  // La parte izada: los imports de "vitest" y las sentencias; lo demás, en blanco.
  const [imports] = parse(js);
  const quedan = [
    ...imports
      .filter((imp) => imp.type === "static" && imp.specifier === "vitest")
      .map((imp) => ({ start: imp.importStart, end: imp.importEnd, texto: js.slice(imp.importStart, imp.importEnd) })),
    ...cambiosHoist,
  ].sort((a, b) => a.start - b.start);
  let hoist = "";
  let desde = 0;
  for (const q of quedan) {
    hoist += enBlanco(js.slice(desde, q.start)) + q.texto;
    desde = q.end;
  }
  hoist += enBlanco(js.slice(desde));

  let salida = js;
  for (const c of [...cambiosJs].sort((a, b) => b.start - a.start)) salida = salida.slice(0, c.start) + c.texto + salida.slice(c.end);
  return { ok: true, js: salida, hoist, mocks: dedupe(mocks) };
}

function dedupe(mocks: readonly MockSpec[]): MockSpec[] {
  return [...new Map(mocks.map((m) => [m.id, m])).values()];
}

function mockSpecOf(especificador: string, ruta: string, ctx: ContextoDeCompilacion): MockSpec | { error: string } {
  if (TEST_SPECIFIERS.includes(especificador)) {
    return { error: `vi.mock("${especificador}"): the test libraries can't be mocked here; mock your own module or a package of the catalog.` };
  }
  const local = resolveLocalImport(especificador, ruta, ctx.carpeta);
  if (local === undefined) return { error: `vi.mock("${especificador}"): there is no such file in the project.` };
  if (local !== null) {
    const destino = compilarFuente(local, ctx.carpeta[local]!, ctx);
    if (!destino.ok) return { error: `vi.mock("${especificador}"): ${local} doesn't compile, so it can't be mocked yet.` };
    const [, exps] = parse(destino.js);
    // Un `export * from` no trae nombre (`type: "reexport-all"`): no se sabe qué exporta.
    if (!exps.every((e) => "name" in e)) {
      return { error: `vi.mock("${especificador}"): ${local} re-exports with export *, so its names can't be known here; mock the module it re-exports from.` };
    }
    const nombres = exps.map((e) => ("name" in e ? e.name : ""));
    return { id: local, exports: nombres.filter((x) => x !== "default").sort(), hasDefault: nombres.includes("default") };
  }
  const dep = ctx.catalogo ? dependenciaDe(ctx.catalogo, especificador) : null;
  if (!dep) return { error: `vi.mock("${especificador}"): it isn't a file of the app nor a package of its catalog.` };
  const nombres = catalogExportsOf(ctx.catalogo!, dep.fichero) ?? [];
  return { id: especificador, exports: nombres.filter((x) => x !== "default").sort(), hasDefault: nombres.includes("default") };
}
