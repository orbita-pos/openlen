import { describe, expect, it } from "vitest";

import { compileCalcRegions } from "./document";
import { disableCalcRegions, repairCalcRegions } from "./repair";

/**
 * Los fixtures NO son inventados: son los tres fallos que la eval de hoy
 * encontró en páginas que el modelo escribió de verdad.
 */
describe("reparar lo INEQUÍVOCO", () => {
  // El sorteo: el modelo puso `data-ol-calc` sobre el BOTÓN, así que los campos
  // y las salidas quedaron fuera de la región y no se compilaba nada. Cero
  // fórmulas, cero issues, silencio absoluto sobre una página que no calculaba.
  it("envuelve las fórmulas que quedaron fuera de toda región", () => {
    const html =
      `<!doctype html><html><body><section id="s">` +
      `<button data-ol-calc data-ol-set="elegido = AZAR(nombres)">Girar</button>` +
      `<ul data-ol-val="nombres"><li data-ol-item>Ana</li></ul>` +
      `<p data-ol-out="elegido">—</p>` +
      `</section></body></html>`;
    const out = repairCalcRegions(html);
    expect(out.did).toContain("wrapped_region");
    // Y ahora SÍ compila: es la prueba de que el arreglo sirve, no de que corrió.
    const compiled = compileCalcRegions(out.html);
    expect(compiled.issues).toEqual([]);
    expect(compiled.compiled).toBe(2);
  });

  // Los paneles solares: campo `recibo` Y deslizador `recibo-range`, y ninguna
  // fórmula leía el segundo. El visitante lo movía y no pasaba nada.
  it("le quita el marcador al campo que nadie lee", () => {
    const html =
      `<!doctype html><html><body><div data-ol-calc>` +
      `<input data-ol-val="recibo" type="number" value="1800">` +
      `<input data-ol-val="recibo-range" type="range" value="1800">` +
      `<p data-ol-out="recibo * 0.72">1296</p>` +
      `</div></body></html>`;
    const out = repairCalcRegions(html);
    expect(out.did).toContain("dropped_orphan_value");
    expect(out.html).not.toContain('data-ol-val="recibo-range"');
    // El control SIGUE en la página — sólo deja de prometer.
    expect(out.html).toContain('type="range"');
    expect(compileCalcRegions(out.html).issues).toEqual([]);
  });
});

describe("lo que NO toca", () => {
  it("una página con cálculos sanos sale byte-idéntica", () => {
    const html =
      `<!doctype html><html><body><div data-ol-calc>` +
      `<input data-ol-val="x" value="2"><p data-ol-out="x * 2">4</p>` +
      `</div></body></html>`;
    const out = repairCalcRegions(html);
    expect(out.html).toBe(html);
    expect(out.repaired).toBe(0);
  });

  it("una página sin nada de cálculo sale byte-idéntica", () => {
    const html = `<!doctype html><html><body><p>hola</p></body></html>`;
    expect(repairCalcRegions(html).html).toBe(html);
  });

  // Envolver <body> haría que TODA la página fuera una región, y el ámbito de
  // nombres —que es la mitad del diseño— dejaría de significar nada.
  it("NO envuelve cuando el único ancestro común es la raíz", () => {
    const html =
      `<!doctype html><html><body>` +
      `<header><input data-ol-val="x" value="1"></header>` +
      `<footer><p data-ol-out="x * 2">2</p></footer>` +
      `</body></html>`;
    const out = repairCalcRegions(html);
    expect(out.did).not.toContain("wrapped_region");
  });

  // Un paréntesis mal contado necesita criterio, y adivinar qué quiso decir el
  // modelo es cómo se rompen las páginas que estaban bien.
  it("NO intenta arreglar una fórmula rota", () => {
    const html =
      `<!doctype html><html><body><div data-ol-calc>` +
      `<input data-ol-val="x" value="1"><p data-ol-out="MONEDA(SI(x, 1, 2)), 0)">0</p>` +
      `</div></body></html>`;
    const out = repairCalcRegions(html);
    expect(out.html).toContain("data-ol-out=");
    expect(compileCalcRegions(out.html).issues.length).toBeGreaterThan(0);
  });

  it("reparar dos veces da el mismo documento", () => {
    const html =
      `<!doctype html><html><body><section>` +
      `<button data-ol-calc data-ol-set="e = AZAR(n)">Girar</button>` +
      `<ul data-ol-val="n"><li data-ol-item>Ana</li></ul><p data-ol-out="e">—</p>` +
      `</section></body></html>`;
    const una = repairCalcRegions(html);
    expect(repairCalcRegions(una.html).html).toBe(una.html);
  });
});

describe("apagar una región que sigue rota", () => {
  /**
   * Lo que hace un error boundary con un widget roto: esconderlo, no mostrarlo
   * muerto. La página queda estática pero ÍNTEGRA — el número de nacimiento ya
   * está escrito dentro del elemento.
   */
  it("no queda ni un control que invite a teclear sin responder", () => {
    const compiled = compileCalcRegions(
      `<!doctype html><html><body><div data-ol-calc data-ol-state="n = 3">` +
      `<input data-ol-val="x" value="7"><p data-ol-out="x * 2">14</p>` +
      `<button data-ol-set="n = n + 1">+1</button>` +
      `</div></body></html>`,
    );
    const off = disableCalcRegions(compiled.html);
    for (const attr of [
      "data-ol-calc", "data-ol-val", "data-ol-state",
      "data-ol-out", "data-ol-if", "data-ol-set",
      "data-ol-out-c", "data-ol-if-c", "data-ol-set-c", "data-ol-state-c",
    ]) {
      expect(off.html, `sobrevivió ${attr}`).not.toContain(`${attr}=`);
    }
    expect(off.html).not.toContain("data-ol-calc>");
    // Y lo que el visitante ve sigue ahí: el número, no un hueco.
    expect(off.html).toContain(">14<");
  });

  it("apaga SÓLO la región indicada, no la página", () => {
    const html =
      `<!doctype html><html><body>` +
      `<div id="a" data-ol-calc><input data-ol-val="x" value="1"><p data-ol-out="x">1</p></div>` +
      `<div id="b" data-ol-calc><input data-ol-val="y" value="2"><p data-ol-out="y">2</p></div>` +
      `</body></html>`;
    const off = disableCalcRegions(compileCalcRegions(html).html, [0]);
    expect(off.html).toContain('id="b" data-ol-calc');
    expect(off.html).toContain('data-ol-val="y"');
    expect(off.html).not.toContain('data-ol-val="x"');
  });

  it("sobre una página sin regiones no hace nada", () => {
    const html = `<!doctype html><html><body><p>hola</p></body></html>`;
    expect(disableCalcRegions(html).html).toBe(html);
  });
});
