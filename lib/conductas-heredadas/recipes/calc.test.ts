import { describe, expect, it } from "vitest";

import { compileCalcRegions } from "@/lib/expr/document";

import { mount, trackDocumentListeners } from "./test-helpers";

/**
 * Monta la región tal y como llega de verdad al navegador: PASANDO por el
 * compilador de la ingestión. Escribir los gemelos `-c` a mano en el fixture
 * probaría un runtime que nadie alimenta así — la mitad de los bugs de esta
 * etapa vivían justo en la costura entre los dos.
 */
function region(inner: string): void {
  const html = `<!doctype html><html><body><div data-ol-calc>${inner}</div></body></html>`;
  const out = compileCalcRegions(html);
  expect(out.issues, "el fixture no compila — el test no probaría el runtime").toEqual([]);
  const body = /<body>([\s\S]*)<\/body>/.exec(out.html)?.[1] ?? "";
  mount(body);
}

const $ = (sel: string) => document.querySelector(sel)!;
const type = (sel: string, value: string) => {
  const el = $(sel) as HTMLInputElement;
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("calc — la página piensa", () => {
  trackDocumentListeners();

  it("el visitante teclea y el número cambia", () => {
    region(
      `<input id="r" data-ol-val="recibo" type="number" value="1800">` +
      `<p id="out" data-ol-out="REDONDEA(recibo * 0.72, 0)" aria-live="polite">0</p>`,
    );
    // Nace calculado, sin que el runtime haya hecho nada.
    expect($("#out").textContent).toBe("1296");
    type("#r", "3000");
    expect($("#out").textContent).toBe("2160");
  });

  it("mostrar-si aparece y desaparece con la condición", () => {
    region(
      `<input id="r" data-ol-val="recibo" type="number" value="1000">` +
      `<p id="msg" data-ol-if="recibo > 3000">Te conviene el plan grande</p>`,
    );
    expect($("#msg").hasAttribute("data-ol-calc-off")).toBe(true);
    type("#r", "5000");
    expect($("#msg").hasAttribute("data-ol-calc-off")).toBe(false);
    type("#r", "10");
    expect($("#msg").hasAttribute("data-ol-calc-off")).toBe(true);
  });

  it("un clic asigna, y lo asignado alimenta otra fórmula", () => {
    region(
      `<ul data-ol-val="nombres"><li data-ol-item>Ana</li><li data-ol-item>Luis</li></ul>` +
      `<button id="go" data-ol-set="elegido = AZAR(nombres)">Sortear</button>` +
      `<p id="out" data-ol-out="elegido">Aún nadie</p>`,
    );
    // Antes de girar respeta el texto del autor — nunca un "0".
    expect($("#out").textContent).toBe("Aún nadie");
    ($("#go") as HTMLElement).click();
    expect(["Ana", "Luis"]).toContain($("#out").textContent);
  });

  it("una casilla vale sí/no y un select vale su opción", () => {
    region(
      `<input id="anual" data-ol-val="anual" type="checkbox">` +
      `<select id="plan" data-ol-val="plan"><option value="199">Pro</option><option value="99">Base</option></select>` +
      `<p id="out" data-ol-out="MONEDA(SI(anual, plan * 10, plan), 0)">0</p>`,
    );
    expect($("#out").textContent).toBe("199");
    const box = $("#anual") as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    expect($("#out").textContent).toBe("1,990");
  });

  it("dos regiones con el MISMO nombre no se pisan", () => {
    const html =
      `<!doctype html><html><body>` +
      `<div data-ol-calc><input id="a" data-ol-val="n" value="2"><p id="oa" data-ol-out="n * 10">20</p></div>` +
      `<div data-ol-calc><input id="b" data-ol-val="n" value="5"><p id="ob" data-ol-out="n * 100">500</p></div>` +
      `</body></html>`;
    const out = compileCalcRegions(html);
    expect(out.issues).toEqual([]);
    mount(/<body>([\s\S]*)<\/body>/.exec(out.html)![1]!);
    type("#a", "3");
    expect($("#oa").textContent).toBe("30");
    // La otra región NO se movió: sus nombres son suyos.
    expect($("#ob").textContent).toBe("500");
  });
});

describe("lo que el runtime NO puede hacer", () => {
  trackDocumentListeners();

  // El guard que ya pagaron countdown, filter y tabs: en el preview el creador
  // puede estar editando el texto de un resultado, y recalcularlo se lo movería
  // bajo el cursor.
  it("en modo edición no toca nada", () => {
    region(
      `<input id="r" data-ol-val="x" value="1"><p id="out" data-ol-out="x * 2">2</p>`,
    );
    document.body.setAttribute("data-openlen-edit-mode", "");
    try {
      type("#r", "50");
      expect($("#out").textContent).toBe("2");
    } finally {
      document.body.removeAttribute("data-openlen-edit-mode");
    }
  });

  // La página piensa, no recuerda: el estado de una asignación vive en una
  // propiedad JS, jamás en el documento — si acabara en un atributo se
  // serializaría al guardar y se publicaría el resultado de un sorteo.
  it("una asignación no deja rastro en el HTML", () => {
    region(
      `<ul data-ol-val="nombres"><li data-ol-item>Ana</li></ul>` +
      `<button id="go" data-ol-set="elegido = AZAR(nombres)">Sortear</button>`,
    );
    ($("#go") as HTMLElement).click();
    expect($("[data-ol-calc]").outerHTML).not.toContain("elegido=");
    expect($("[data-ol-calc]").outerHTML).not.toContain("Ana</div>");
  });

  // La fórmula produce TEXTO, siempre. Si el runtime usara innerHTML, una
  // fórmula con marcado dentro lo inyectaría — el saneador es una capa, no la
  // única.
  it("un resultado con marcado dentro llega como texto, no como HTML", () => {
    region(
      `<input id="r" data-ol-val="x" value="1">` +
      `<p id="out" data-ol-out="UNE('&lt;img src=x onerror=alert(1)&gt;', x)">-</p>`,
    );
    type("#r", "2");
    expect($("#out").querySelector("img")).toBeNull();
    expect($("#out").textContent).toContain("<img");
  });
});

/**
 * LA prueba de la costura. El valor que la ingestión escribe DENTRO del
 * elemento y el que el runtime calcula al montar tienen que ser el MISMO — si
 * no, una página sin JS enseña un número y con JS enseña otro.
 *
 * Existe porque esa divergencia ya ocurrió: la ingestión evaluaba con el
 * entorno vacío, así que un campo con `value="1800"` nacía diciendo 0 mientras
 * el navegador decía 1296. No un hueco — un número FALSO, que es peor.
 */
describe("nacimiento y runtime dicen lo MISMO", () => {
  trackDocumentListeners();

  const CASOS: Array<[string, string]> = [
    ["campo con valor inicial",
      `<input data-ol-val="recibo" type="number" value="1800"><p id="o" data-ol-out="REDONDEA(recibo * 0.72, 0)">?</p>`],
    ["campo vacío",
      `<input data-ol-val="x" type="number"><p id="o" data-ol-out="x + 10">?</p>`],
    ["casilla marcada",
      `<input data-ol-val="anual" type="checkbox" checked><p id="o" data-ol-out="SI(anual, 'sí', 'no')">?</p>`],
    ["casilla sin marcar",
      `<input data-ol-val="anual" type="checkbox"><p id="o" data-ol-out="SI(anual, 'sí', 'no')">?</p>`],
    ["select sin selected — vale la primera opción",
      `<select data-ol-val="plan"><option value="199">Pro</option><option value="99">Base</option></select><p id="o" data-ol-out="MONEDA(plan, 0)">?</p>`],
    ["select con selected",
      `<select data-ol-val="plan"><option value="199">Pro</option><option value="99" selected>Base</option></select><p id="o" data-ol-out="MONEDA(plan, 0)">?</p>`],
    ["radio marcado",
      `<input data-ol-val="t" type="radio" value="10"><input data-ol-val="t" type="radio" value="20" checked><p id="o" data-ol-out="t * 3">?</p>`],
    ["radio sin marcar",
      `<input data-ol-val="t" type="radio" value="10"><input data-ol-val="t" type="radio" value="20"><p id="o" data-ol-out="t * 3">?</p>`],
    ["lista",
      `<ul data-ol-val="ns"><li data-ol-item>Ana</li><li data-ol-item>Luis</li></ul><p id="o" data-ol-out="CUENTA(ns)">?</p>`],
    ["texto suelto",
      `<span data-ol-val="ciudad">Oaxaca</span><p id="o" data-ol-out="UNE('Hola ', ciudad)">?</p>`],
    ["booleano de una comparación",
      `<input data-ol-val="n" type="number" value="9"><p id="o" data-ol-out="n > 7">?</p>`],
  ];

  it.each(CASOS)("%s", (_nombre, inner) => {
    const html = `<!doctype html><html><body><div data-ol-calc>${inner}</div></body></html>`;
    const out = compileCalcRegions(html);
    expect(out.issues).toEqual([]);
    const body = /<body>([\s\S]*)<\/body>/.exec(out.html)![1]!;

    // Lo que la ingestión dejó escrito: lo que ve un visitante SIN JS.
    document.body.innerHTML = body;
    const sinJs = $("#o").textContent;
    expect(sinJs, "la ingestión no escribió nada").not.toBe("?");

    // Y lo que el runtime pone al montar, sobre el MISMO documento.
    mount(body);
    expect($("#o").textContent).toBe(sinJs);
  });
});
