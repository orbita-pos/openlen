// lib/apps/tests/vitest-runtime.js — LO QUE ES `vitest` DENTRO DEL NAVEGADOR
// (plan 04). Lo que una prueba importa de "vitest" es esto, empaquetado con su
// prueba por `bundle-tests.ts` y corrido en el Chromium de los ojos por
// `run-tests.ts`: como el modo navegador de vitest, sin Node ni Vite.
//
// Las piezas que juzgan son las de vitest, del kit congelado: `expect` es
// `@vitest/expect` (chai con los matchers de Jest), `vi.fn`/`vi.spyOn` son
// `@vitest/spy`, el diff de un fallo es `@vitest/utils/diff`, y los relojes
// falsos son `@sinonjs/fake-timers`, como en vitest. Lo nuestro es el corredor
// (`describe/it`, ganchos, topes) y el registro de los simulados (`vi.mock`,
// izado por el compilador de pruebas: `compile-tests.ts`).
//
// Los globales van SIEMPRE (`globals: true`): el modelo los usa sin importar, y
// Testing Library limpia sola el DOM tras cada prueba si ve `afterEach`.
//
// Sus topes son los de vitest: 5 s por prueba (`testTimeout`), 10 s por gancho
// (`hookTimeout`). Se miden con el reloj VERDADERO, guardado antes de que una
// prueba instale los falsos.
import { chai, getState, JestAsymmetricMatchers, JestChaiExpect, JestExtend, setState } from "@vitest/expect";
import * as spy from "@vitest/spy";
import { diff } from "@vitest/utils/diff";
import * as matchers from "@testing-library/jest-dom/matchers";
import { withGlobal } from "@sinonjs/fake-timers";

const reloj = { setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis), now: () => performance.now() };
const TEST_TIMEOUT = 5000;
const HOOK_TIMEOUT = 10000;

// ── expect ─────────────────────────────────────────────────────────────────
chai.use(JestExtend);
chai.use(JestChaiExpect);
chai.use(JestAsymmetricMatchers);

export const expect = (value, message) => {
  const { assertionCalls } = getState(expect);
  setState({ assertionCalls: assertionCalls + 1 }, expect);
  return chai.expect(value, message);
};
Object.assign(expect, chai.expect);
expect.getState = () => getState(expect);
expect.setState = (s) => setState(s, expect);
expect.extend = (m) => chai.expect.extend(expect, m);
expect.soft = expect;
// Estos tres los pone vitest (su `createExpect`), no `@vitest/expect`: el
// corredor los comprueba al acabar cada prueba.
expect.assertions = (n) => setState({ expectedAssertionsNumber: n }, expect);
expect.hasAssertions = () => setState({ isExpectingAssertions: true }, expect);
expect.unreachable = (mensaje) => chai.assert.fail(`expected${mensaje ? ` "${mensaje}" ` : " "}not to be reached`);
expect.extend(matchers);
const sinSnapshots = () => {
  throw new Error("Snapshots aren't available here (there is no snapshot file): compare with toEqual / toHaveTextContent instead.");
};
for (const nombre of ["toMatchSnapshot", "toMatchInlineSnapshot", "toThrowErrorMatchingSnapshot", "toThrowErrorMatchingInlineSnapshot", "toMatchFileSnapshot"]) {
  chai.Assertion.addMethod(nombre, sinSnapshots);
}
export const assert = chai.assert;

// ── vi ─────────────────────────────────────────────────────────────────────
const fabricas = new Map();
const globalesCambiados = [];
let relojFalso = null;
const QUE_SE_FALSEA = ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "Date"];

function exigirRelojFalso() {
  if (!relojFalso) throw new Error('Timers are not mocked. Try calling "vi.useFakeTimers()" first.');
  return relojFalso;
}

export const vi = {
  fn: spy.fn,
  spyOn: spy.spyOn,
  isMockFunction: spy.isMockFunction,
  clearAllMocks: () => (spy.clearAllMocks(), vi),
  resetAllMocks: () => (spy.resetAllMocks(), vi),
  restoreAllMocks: () => (spy.restoreAllMocks(), vi),
  mocked: (x) => x,
  // Izados por el compilador de pruebas: cuando corren, aún no se ha importado nada.
  mock: (id, fabrica) => void fabricas.set(id, fabrica ?? null),
  unmock: (id) => void fabricas.delete(id),
  hoisted: (fn) => fn(),
  doMock: () => {
    throw new Error("vi.doMock isn't available here: use vi.mock at the top of the test file (it is hoisted, as in vitest).");
  },
  importActual: async () => {
    throw new Error("vi.importActual isn't available here: use the factory's importOriginal — vi.mock(path, async (importOriginal) => ({ ...(await importOriginal()), x: vi.fn() })).");
  },
  useFakeTimers(opciones = {}) {
    relojFalso?.uninstall();
    const toFake = (opciones.toFake ?? QUE_SE_FALSEA).filter((k) => k in globalThis);
    relojFalso = withGlobal(globalThis).install({ ...opciones, toFake, shouldClearNativeTimers: true, now: opciones.now ?? Date.now() });
    return vi;
  },
  useRealTimers() {
    relojFalso?.uninstall();
    relojFalso = null;
    return vi;
  },
  isFakeTimers: () => relojFalso !== null,
  advanceTimersByTime: (ms) => (exigirRelojFalso().tick(ms), vi),
  advanceTimersByTimeAsync: async (ms) => (await exigirRelojFalso().tickAsync(ms), vi),
  advanceTimersToNextTimer: () => (exigirRelojFalso().next(), vi),
  runAllTimers: () => (exigirRelojFalso().runAll(), vi),
  runAllTimersAsync: async () => (await exigirRelojFalso().runAllAsync(), vi),
  runOnlyPendingTimers: () => (exigirRelojFalso().runToLast(), vi),
  getTimerCount: () => exigirRelojFalso().countTimers(),
  setSystemTime: (t) => {
    if (relojFalso) relojFalso.setSystemTime(t);
    else throw new Error('vi.setSystemTime needs fake timers here: call "vi.useFakeTimers()" first.');
    return vi;
  },
  getRealSystemTime: () => (relojFalso ? relojFalso.Date.now() : Date.now()),
  stubGlobal(nombre, valor) {
    globalesCambiados.push([nombre, Object.getOwnPropertyDescriptor(globalThis, nombre)]);
    Object.defineProperty(globalThis, nombre, { value: valor, writable: true, configurable: true, enumerable: true });
    return vi;
  },
  unstubAllGlobals() {
    for (const [nombre, d] of globalesCambiados.splice(0).reverse()) {
      if (d) Object.defineProperty(globalThis, nombre, d);
      else delete globalThis[nombre];
    }
    return vi;
  },
  async waitFor(cb, opciones = {}) {
    const { timeout = 1000, interval = 50 } = typeof opciones === "number" ? { timeout: opciones } : opciones;
    const hasta = reloj.now() + timeout;
    for (;;) {
      try {
        return await cb();
      } catch (e) {
        if (reloj.now() >= hasta) throw e;
      }
      await new Promise((r) => reloj.setTimeout(r, interval));
    }
  },
  async waitUntil(cb, opciones = {}) {
    const { timeout = 1000, interval = 50 } = typeof opciones === "number" ? { timeout: opciones } : opciones;
    const hasta = reloj.now() + timeout;
    for (;;) {
      const v = await cb();
      if (v) return v;
      if (reloj.now() >= hasta) throw new Error(`Timed out in waitUntil!`);
      await new Promise((r) => reloj.setTimeout(r, interval));
    }
  },
};

/** El módulo que sustituye a uno simulado lo pide aquí (`bundle-tests.ts`). */
export async function __mockedModule(id, importOriginal) {
  if (!fabricas.has(id)) return importOriginal();
  const fabrica = fabricas.get(id);
  if (fabrica === null) return automock(await importOriginal());
  let m;
  try {
    m = await fabrica(importOriginal);
  } catch (e) {
    const err = new Error(
      `[vitest] There was an error when mocking a module. If you are using "vi.mock" factory, make sure there are no top level variables inside, since this call is hoisted to top of the file. ${e instanceof Error ? e.message : String(e)}`,
    );
    err.cause = e;
    throw err;
  }
  if (m === null || typeof m !== "object") {
    throw new Error(`[vitest] vi.mock("${id}", factory?) is not returning an object. Did you mean to return an object with a "default" key?`);
  }
  return m;
}

/** Lo que el módulo simulado exporta cuando la fábrica no dio ese nombre: un
 *  valor que lanza el aviso de vitest en cuanto se usa. */
export function __missingExport(id, nombre) {
  const aviso = () => {
    throw new Error(`[vitest] No "${nombre}" export is defined on the "${id}" mock. Did you want to return the actual module?`);
  };
  return new Proxy(aviso, { apply: aviso, construct: aviso, get: (t, p) => (p === Symbol.toPrimitive || p === "then" ? undefined : aviso()) });
}

/** Sin fábrica, como vitest: las funciones son `vi.fn()` que no hacen nada,
 *  los objetos se recorren, los arrays quedan vacíos y lo demás se queda. */
function automock(valor, vistos = new Map()) {
  if (typeof valor === "function") return spy.fn();
  if (Array.isArray(valor)) return [];
  if (valor === null || typeof valor !== "object") return valor;
  if (vistos.has(valor)) return vistos.get(valor);
  const copia = {};
  vistos.set(valor, copia);
  for (const k of Object.keys(valor)) copia[k] = automock(valor[k], vistos);
  return copia;
}

// ── el corredor ────────────────────────────────────────────────────────────
const nuevoGrupo = (nombre, padre, modo) => ({ nombre, padre, modo, hijos: [], beforeAll: [], afterAll: [], beforeEach: [], afterEach: [] });
const raiz = nuevoGrupo("", null, "run");
let actual = raiz;
let hayOnly = false;

/** `test.each` con `%s %i %d %f %j %o %%` y `$prop`, como vitest. */
function formatear(nombre, fila, i) {
  const args = Array.isArray(fila) ? [...fila] : [fila];
  let t = String(nombre).replace(/%[sidfjo%#]/g, (m) => {
    if (m === "%%") return "%";
    if (m === "%#") return String(i);
    const v = args.shift();
    if (m === "%i") return String(Math.trunc(Number(v)));
    if (m === "%d" || m === "%f") return String(Number(v));
    if (m === "%j" || m === "%o") return JSON.stringify(v);
    return typeof v === "string" ? v : JSON.stringify(v);
  });
  if (!Array.isArray(fila) && fila && typeof fila === "object") t = t.replace(/\$([\w.]+)/g, (m, k) => (k in fila ? String(fila[k]) : m));
  return t;
}

/** `it(nombre, fn, tope)`, `it(nombre, { timeout }, fn)` o `it(nombre, fn, { timeout })`. */
function argumentos(b, c) {
  if (typeof b === "function") return { fn: b, timeout: typeof c === "number" ? c : (c?.timeout ?? TEST_TIMEOUT) };
  return { fn: c, timeout: b?.timeout ?? TEST_TIMEOUT };
}

function crear(tipo, modoBase) {
  const f = (nombre, b, c) => {
    const { fn, timeout } = argumentos(b, c);
    const modo = modoBase === "run" && actual.modo !== "run" ? actual.modo : modoBase;
    if (modo === "only") hayOnly = true;
    if (tipo === "suite") {
      const g = nuevoGrupo(String(nombre), actual, modo);
      actual.hijos.push(g);
      const antes = actual;
      actual = g;
      try {
        fn?.();
      } finally {
        actual = antes;
      }
    } else {
      actual.hijos.push({ nombre: String(nombre), fn, timeout, modo: fn ? modo : "todo" });
    }
  };
  if (modoBase === "run") {
    f.skip = crear(tipo, "skip");
    f.only = crear(tipo, "only");
    f.todo = (nombre) => f.skip(nombre);
    if (tipo === "test") f.todo = (nombre) => actual.hijos.push({ nombre: String(nombre), fn: null, timeout: 0, modo: "todo" });
    f.skipIf = (c) => (c ? f.skip : f);
    f.runIf = (c) => (c ? f : f.skip);
    f.concurrent = f;
    f.sequential = f;
    f.each = (tabla) => (nombre, b, c) => {
      const { fn, timeout } = argumentos(b, c);
      tabla.forEach((fila, i) => f(formatear(nombre, fila, i), Array.isArray(fila) ? () => fn(...fila) : () => fn(fila), timeout));
    };
  }
  return f;
}

export const describe = crear("suite", "run");
export const suite = describe;
export const it = crear("test", "run");
export const test = it;
export const beforeAll = (fn, t = HOOK_TIMEOUT) => void actual.beforeAll.push([fn, t]);
export const afterAll = (fn, t = HOOK_TIMEOUT) => void actual.afterAll.push([fn, t]);
export const beforeEach = (fn, t = HOOK_TIMEOUT) => void actual.beforeEach.push([fn, t]);
export const afterEach = (fn, t = HOOK_TIMEOUT) => void actual.afterEach.push([fn, t]);

Object.assign(globalThis, { describe, suite, it, test, expect, vi, assert, beforeAll, afterAll, beforeEach, afterEach });
globalThis.__openlenHoisted = [];

function conTope(promesa, ms, mensaje) {
  let t;
  return Promise.race([
    Promise.resolve().then(promesa).finally(() => reloj.clearTimeout(t)),
    new Promise((_, no) => {
      t = reloj.setTimeout(() => no(new Error(mensaje)), ms);
    }),
  ]);
}

function serializar(e) {
  const err = e instanceof Error ? e : new Error(String(e));
  let d = null;
  if (err.showDiff !== false && "expected" in err && "actual" in err && err.expected !== undefined) {
    const sinColor = (s) => s;
    d = diff(err.expected, err.actual, { aColor: sinColor, bColor: sinColor, changeColor: sinColor, commonColor: sinColor, patchColor: sinColor }) ?? null;
  }
  return { name: err.name || "Error", message: err.message, stack: err.stack ?? "", diff: d };
}

const fueraDeTiempo = (ms) => `Test timed out in ${ms}ms.\nIf this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".`;

async function correrGrupo(g, ruta, beforeEachs, afterEachs, filtro, salida) {
  const tieneAlgo = (n) => (n.hijos ? n.hijos.some(tieneAlgo) : true);
  if (!tieneAlgo(g)) return;
  for (const [fn, t] of g.beforeAll) await conTope(fn, t, `Hook timed out in ${t}ms.`);
  const be = [...beforeEachs, ...g.beforeEach];
  const ae = [...g.afterEach, ...afterEachs];
  for (const h of g.hijos) {
    if (h.hijos) {
      await correrGrupo(h, [...ruta, h.nombre], be, ae, filtro, salida);
      continue;
    }
    const nombre = [...ruta, h.nombre];
    const fuera = h.modo === "skip" || (hayOnly && h.modo !== "only" && !dentroDeOnly(g)) || (filtro && !filtro.test(nombre.join(" ")));
    if (h.modo === "todo") {
      salida.push({ name: nombre, state: "todo", ms: 0, error: null });
      continue;
    }
    if (fuera) {
      salida.push({ name: nombre, state: "skip", ms: 0, error: null });
      continue;
    }
    const t0 = reloj.now();
    let error = null;
    setState({ assertionCalls: 0, isExpectingAssertions: false, isExpectingAssertionsError: null, expectedAssertionsNumber: null, expectedAssertionsNumberErrorGen: null }, expect);
    try {
      for (const [fn, t] of be) await conTope(fn, t, `Hook timed out in ${t}ms.`);
      await conTope(h.fn, h.timeout, fueraDeTiempo(h.timeout));
      const s = getState(expect);
      if (s.expectedAssertionsNumber !== null && s.assertionCalls !== s.expectedAssertionsNumber) {
        throw new Error(`expected number of assertions to be ${s.expectedAssertionsNumber}, but got ${s.assertionCalls}`);
      }
      if (s.isExpectingAssertions && s.assertionCalls === 0) throw new Error("expected any number of assertion, but got none");
    } catch (e) {
      error = serializar(e);
    }
    for (const [fn, t] of ae) {
      try {
        await conTope(fn, t, `Hook timed out in ${t}ms.`);
      } catch (e) {
        error ??= serializar(e);
      }
    }
    salida.push({ name: nombre, state: error ? "fail" : "pass", ms: Math.round(reloj.now() - t0), error });
  }
  for (const [fn, t] of g.afterAll) await conTope(fn, t, `Hook timed out in ${t}ms.`);
}

function dentroDeOnly(g) {
  for (let x = g; x; x = x.padre) if (x.modo === "only") return true;
  return false;
}

const sinCapturar = [];
globalThis.addEventListener("error", (ev) => sinCapturar.push(serializar(ev.error ?? ev.message)));
globalThis.addEventListener("unhandledrejection", (ev) => sinCapturar.push(serializar(ev.reason)));

/** Corre lo que el fichero registró al cargarse y deja el resultado. */
export async function __runFile(file, opciones = {}) {
  const t0 = reloj.now();
  const tests = [];
  const filtro = opciones.testNamePattern ? new RegExp(opciones.testNamePattern) : null;
  let fileError = null;
  try {
    await correrGrupo(raiz, [], [], [], filtro, tests);
  } catch (e) {
    fileError = serializar(e);
  }
  globalThis.__openlenTestResult = { file, tests, fileError, unhandled: sinCapturar.slice(), ms: Math.round(reloj.now() - t0) };
}

/** El fichero no llegó a cargarse (un error al importarlo). */
export function __fileFailed(file, error) {
  globalThis.__openlenTestResult = { file, tests: [], fileError: serializar(error), unhandled: sinCapturar.slice(), ms: 0 };
}
