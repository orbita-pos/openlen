// @vitest-environment node
// `vitest` dentro del navegador (plan 04, tarea 2): el corredor, el expect real
// de vitest con jest-dom, vi, los simulados. Con Chromium de verdad.
import { describe, expect, it } from "vitest";
import { runInChromium } from "./runtime-harness";

type R = { tests: { name: string[]; state: string; error: { message: string; diff: string | null } | null }[]; fileError: unknown; unhandled: unknown[] };
const correr = async (codigo: string, extra: Record<string, string> = {}) =>
  (await runInChromium({ "/src/a.test.js": codigo, ...extra }, "/src/a.test.js")) as R;
const estados = (r: R) => r.tests.map((t) => `${t.state} ${t.name.join(" > ")}`);

describe("el corredor", () => {
  it("🔴 describe/it/test, skip/only/todo/each, ganchos en su orden", async () => {
    const r = await correr(`
import { describe, it, test, expect, beforeEach, afterEach, beforeAll } from "vitest";
const log = [];
beforeAll(() => log.push("all"));
describe("g", () => {
  beforeEach(() => log.push("be"));
  afterEach(() => log.push("ae"));
  it("a", () => { log.push("a"); expect(1).toBe(1); });
  it.skip("b", () => {});
  it.todo("c");
  test.each([[1, 2], [2, 3]])("suma %i", (x, y) => expect(x + 1).toBe(y));
  it("orden", () => expect(log.slice(0, 7)).toEqual(["all", "be", "a", "ae", "be", "ae", "be"]));
});`);
    expect(estados(r)).toEqual(["pass g > a", "skip g > b", "todo g > c", "pass g > suma 1", "pass g > suma 2", "pass g > orden"]);
  }, 60_000);

  it("🔴 un fallo trae el mensaje de vitest y su diff", async () => {
    const r = await correr(`import { it, expect } from "vitest";\nit("mal", () => { expect(1 + 2).toBe(4); });`);
    expect(r.tests[0]!.state).toBe("fail");
    expect(r.tests[0]!.error!.message).toBe("expected 3 to be 4 // Object.is equality");
    expect(r.tests[0]!.error!.diff).toBe("- Expected\n+ Received\n\n- 4\n+ 3");
  }, 60_000);

  it("🔴 una promesa que no acaba: 'Test timed out in 5000ms.' y sigue la siguiente (Review Focus 1)", async () => {
    const r = await correr(`import { it, expect } from "vitest";\nit("cuelga", () => new Promise(() => {}));\nit("sigue", () => expect(1).toBe(1));`);
    expect(estados(r)).toEqual(["fail cuelga", "pass sigue"]);
    expect(r.tests[0]!.error!.message).toMatch(/^Test timed out in 5000ms\./);
  }, 60_000);

  it("los globales están (sin import), y .only deja sólo ésa", async () => {
    const r = await correr(`describe("g", () => { it("x", () => {}); it.only("y", () => expect(true).toBeTruthy()); });`);
    expect(estados(r)).toEqual(["skip g > x", "pass g > y"]);
  }, 60_000);

  it("expect.assertions(n) y hasAssertions, como vitest", async () => {
    const r = await correr(`import { it, expect } from "vitest";\nit("dos", () => { expect.assertions(2); expect(1).toBe(1); });`);
    expect(r.tests[0]!.error!.message).toBe("expected number of assertions to be 2, but got 1");
  }, 60_000);
});

describe("Testing Library y jest-dom", () => {
  it("🔴 render + screen + userEvent + toBeInTheDocument, y la limpieza entre pruebas", async () => {
    const r = await correr(`
import { it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { createElement as h, useState } from "react";
function Contador({ onCambio }) { const [n, setN] = useState(0); return h("div", null, h("p", null, "Total: " + n), h("button", { onClick: () => { setN(n + 1); onCambio?.(n + 1); } }, "Sumar")); }
it("suma", async () => {
  const onCambio = vi.fn();
  render(h(Contador, { onCambio }));
  await userEvent.setup().click(screen.getByRole("button", { name: /sumar/i }));
  expect(screen.getByText("Total: 1")).toBeInTheDocument();
  expect(onCambio).toHaveBeenCalledWith(1);
});
it("limpio", () => { expect(document.body.textContent).toBe(""); });`);
    expect(estados(r)).toEqual(["pass suma", "pass limpio"]);
  }, 60_000);
});

describe("vi", () => {
  it("🔴 relojes falsos: advanceTimersByTime mueve setTimeout y Date; el tope de 5 s no se falsea", async () => {
    const r = await correr(`
import { it, expect, vi } from "vitest";
it("reloj", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  let hecho = false; setTimeout(() => { hecho = true; }, 60_000);
  vi.advanceTimersByTime(60_000);
  expect(hecho).toBe(true);
  expect(new Date().toISOString()).toBe("2026-01-01T00:01:00.000Z");
  vi.useRealTimers();
});`);
    expect(estados(r)).toEqual(["pass reloj"]);
  }, 60_000);

  it("🔴 __mockedModule: la fábrica, importOriginal, automock sin fábrica, y el aviso si no es un objeto (Review Focus 3)", async () => {
    const r = await correr(`
import { it, expect, vi, __mockedModule, __missingExport } from "vitest";
const real = async () => ({ suma: (a, b) => a + b, PI: 3, obj: { f: () => 1 } });
it("fábrica con importOriginal", async () => {
  vi.mock("/src/m.js", async (importOriginal) => ({ ...(await importOriginal()), PI: 4 }));
  const m = await __mockedModule("/src/m.js", real);
  expect([m.PI, m.suma(1, 2)]).toEqual([4, 3]);
});
it("automock", async () => {
  vi.mock("/src/n.js");
  const m = await __mockedModule("/src/n.js", real);
  expect(vi.isMockFunction(m.suma)).toBe(true);
  expect(m.suma(1, 2)).toBe(undefined);
  expect(m.PI).toBe(3);
  expect(vi.isMockFunction(m.obj.f)).toBe(true);
});
it("no es un objeto", async () => {
  vi.mock("/src/o.js", () => 5);
  await expect(__mockedModule("/src/o.js", real)).rejects.toThrow('[vitest] vi.mock("/src/o.js", factory?) is not returning an object. Did you mean to return an object with a "default" key?');
});
it("export que la fábrica no dio", () => {
  expect(() => __missingExport("/src/m.js", "otro")()).toThrow('[vitest] No "otro" export is defined on the "/src/m.js" mock. Did you want to return the actual module?');
});
it("sin vi.mock, el real", async () => { expect((await __mockedModule("/src/p.js", real)).PI).toBe(3); });`);
    expect(estados(r)).toEqual(["pass fábrica con importOriginal", "pass automock", "pass no es un objeto", "pass export que la fábrica no dio", "pass sin vi.mock, el real"]);
  }, 60_000);

  it("lo que no hay lo dice: snapshots, doMock, importActual", async () => {
    const r = await correr(`
import { it, expect, vi } from "vitest";
it("snap", () => { expect(1).toMatchSnapshot(); });
it("doMock", () => { vi.doMock("/src/x.js"); });
it("importActual", async () => { await vi.importActual("/src/x.js"); });`);
    expect(r.tests.map((t) => t.error?.message)).toEqual([
      "Snapshots aren't available here (there is no snapshot file): compare with toEqual / toHaveTextContent instead.",
      "vi.doMock isn't available here: use vi.mock at the top of the test file (it is hoisted, as in vitest).",
      "vi.importActual isn't available here: use the factory's importOriginal — vi.mock(path, async (importOriginal) => ({ ...(await importOriginal()), x: vi.fn() })).",
    ]);
  }, 60_000);

  it("un fichero que lanza al cargarse: fileError, ninguna prueba", async () => {
    const r = await correr(`import { it } from "vitest";\nthrow new Error("al cargar");\nit("x", () => {});`);
    expect(r.tests).toEqual([]);
    expect(r.fileError).toMatchObject({ message: "al cargar" });
  }, 60_000);
});
