import { describe, expect, it } from "vitest";

import { compileCalcRegions } from "./document";

const region = (inner: string) =>
  `<!doctype html><html><body><div data-ol-calc>${inner}</div></body></html>`;

describe("compilar una región", () => {
  it("deja la fórmula legible y le pone su gemelo compilado al lado", () => {
    const out = compileCalcRegions(region(
      `<input data-ol-val="recibo"><p data-ol-out="recibo * 0.72">0</p>`,
    ));
    // La legible se queda: es lo que el Chat edita y lo que un humano entiende.
    expect(out.html).toContain(`data-ol-out="recibo * 0.72"`);
    expect(out.html).toContain(`data-ol-out-c="[&quot;$recibo&quot;,0.72,&quot;*&quot;]"`);
    expect(out.issues).toEqual([]);
    expect(out.compiled).toBe(1);
  });

  // Sin esto, una página con cálculo y sin runtime muestra un hueco donde
  // debería ir un número — y conformance exige content-intact COMPUTADO.
  it("la página nace con un número visible, aunque el runtime nunca corra", () => {
    const out = compileCalcRegions(region(
      `<input data-ol-val="recibo"><p data-ol-out="REDONDEA(recibo * 0.72 + 100, 0)">—</p>`,
    ));
    expect(out.html).toContain(">100<");
    expect(out.html).not.toContain(">—<");
  });

  it("un documento sin regiones sale byte-idéntico", () => {
    const html = `<!doctype html><html><body><p>hola</p></body></html>`;
    expect(compileCalcRegions(html)).toEqual({ html, regions: 0, compiled: 0, issues: [] });
  });

  it("compila mostrar-si y asignaciones, no sólo salidas", () => {
    const out = compileCalcRegions(region(
      `<input data-ol-val="puntaje">` +
      `<p data-ol-if="puntaje > 7">alto</p>` +
      `<button data-ol-when="clic" data-ol-set="puntaje = puntaje + 1">+1</button>`,
    ));
    expect(out.compiled).toBe(2);
    expect(out.html).toContain("data-ol-if-c=");
    expect(out.html).toContain("data-ol-set-c=");
  });
});

describe("lo que NACE MUERTO se dice al ingerir, no en la página del visitante", () => {
  it("una fórmula que no parsea se reporta con el motivo", () => {
    const out = compileCalcRegions(region(
      `<input data-ol-val="x"><p data-ol-out="x * ">0</p>`,
    ));
    expect(out.issues).toHaveLength(1);
    expect(out.compiled).toBe(0);
    // Y NO se escribe gemelo: media compilación es peor que ninguna.
    expect(out.html).not.toContain("data-ol-out-c");
  });

  it("una fórmula que apunta a un campo inexistente se reporta, y dice cuál", () => {
    const out = compileCalcRegions(region(
      `<input data-ol-val="recibo"><p data-ol-out="recibo * tarifa">0</p>`,
    ));
    expect(out.issues).toHaveLength(1);
    expect(out.issues[0]!.message).toContain(`"tarifa"`);
    expect(out.issues[0]!.message).toContain(`data-ol-val="tarifa"`);
  });

  it("un destino de asignación SÍ cuenta como declarado — la ruleta lo necesita", () => {
    const out = compileCalcRegions(region(
      `<ul data-ol-val="nombres"><li data-ol-item>Ana</li></ul>` +
      `<button data-ol-when="clic" data-ol-set="elegido = AZAR(nombres)">Girar</button>` +
      `<p data-ol-out="elegido">—</p>`,
    ));
    expect(out.issues).toEqual([]);
    expect(out.compiled).toBe(2);
  });

  it("una fórmula rota NO impide compilar las sanas de la misma región", () => {
    const out = compileCalcRegions(region(
      `<input data-ol-val="a"><p data-ol-out="a * 2">0</p><p data-ol-out="a * ">0</p>`,
    ));
    expect(out.compiled).toBe(1);
    expect(out.issues).toHaveLength(1);
  });
});

describe("las regiones no se pisan entre sí", () => {
  it("dos calculadoras en la misma página tienen nombres independientes", () => {
    const html =
      `<!doctype html><html><body>` +
      `<div data-ol-calc><input data-ol-val="total"><p data-ol-out="total * 2">0</p></div>` +
      `<div data-ol-calc><input data-ol-val="total"><p data-ol-out="total * 3">0</p></div>` +
      `</body></html>`;
    const out = compileCalcRegions(html);
    expect(out.regions).toBe(2);
    expect(out.issues).toEqual([]);
  });

  it("un nombre de OTRA región no vale — sería una fórmula muerta en silencio", () => {
    const html =
      `<!doctype html><html><body>` +
      `<div data-ol-calc><input data-ol-val="tarifa"></div>` +
      `<div data-ol-calc><input data-ol-val="peso"><p data-ol-out="peso * tarifa">0</p></div>` +
      `</body></html>`;
    const out = compileCalcRegions(html);
    expect(out.issues).toHaveLength(1);
    expect(out.issues[0]!.message).toContain(`"tarifa"`);
  });
});

describe("no puede tumbar una página", () => {
  it("volver a compilar da el mismo documento — es idempotente", () => {
    const once = compileCalcRegions(region(
      `<input data-ol-val="x"><p data-ol-out="x + 1">0</p>`,
    ));
    expect(compileCalcRegions(once.html).html).toBe(once.html);
  });

  it("el resultado inicial se escapa — sale de una fórmula, no del autor", () => {
    const out = compileCalcRegions(region(
      `<input data-ol-val="x"><p data-ol-out="'&lt;img onerror=alert(1)&gt;'">0</p>`,
    ));
    expect(out.html).not.toContain("<img onerror");
  });
});

describe("el gemelo compilado no lleva marcado crudo", () => {
  // JSON.stringify no escapa < ni >, y setAttribute sólo escapa comillas: un
  // texto literal con marcado salía crudo dentro del atributo. Entre comillas
  // es inerte, pero depender de eso es sostener un "depende".
  it("los ángulos viajan escapados", () => {
    const out = compileCalcRegions(region(
      `<input data-ol-val="x"><p data-ol-out="'&lt;b&gt;hola&lt;/b&gt;'">0</p>`,
    ));
    expect(out.html).toContain("data-ol-out-c=");
    expect(out.html).not.toContain("<b>hola</b>");
  });

  it("y siguen siendo JSON que da la vuelta idéntico", () => {
    const out = compileCalcRegions(region(
      `<input data-ol-val="x"><p data-ol-out="'&lt;b&gt;'">0</p>`,
    ));
    const attr = /data-ol-out-c="([^"]*)"/.exec(out.html)?.[1] ?? "";
    const json = attr.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    expect(JSON.parse(json)).toEqual(["'<b>"]);
  });
});
