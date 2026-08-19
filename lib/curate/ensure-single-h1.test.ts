import { describe, expect, it } from "vitest";

import { ensureSingleH1 } from "./ensure-single-h1";

const page = (body: string) => `<!doctype html><html><body>${body}</body></html>`;

describe("exactamente un h1", () => {
  it("deja en paz la página que ya tiene uno", () => {
    const html = page("<section><h1>Hola</h1></section><section><h2>Otro</h2></section>");
    expect(ensureSingleH1(html)).toEqual({ html, changed: false });
  });

  it("baja los sobrantes y conserva el primero", () => {
    const out = ensureSingleH1(page('<section><h1 class="a">Uno</h1></section><section><h1 class="b">Dos</h1></section>'));
    expect(out.changed).toBe(true);
    expect(out.html).toContain('<h1 class="a">Uno</h1>');
    expect(out.html).toContain('<h2 class="b">Dos</h2>');
  });

  it("sube el primer h2 cuando no hay ningún h1", () => {
    const out = ensureSingleH1(page('<section><h2 class="t" data-x="1">Titular</h2></section><section><h2>Otro</h2></section>'));
    expect(out.changed).toBe(true);
    expect(out.html).toContain('<h1 class="t" data-x="1">Titular</h1>');
    expect(out.html).toContain("<h2>Otro</h2>");
  });

  it("no inventa un titular donde no hay ningún encabezado", () => {
    const html = page("<section><p>solo texto</p></section>");
    expect(ensureSingleH1(html)).toEqual({ html, changed: false });
  });

  it("conserva el contenido interno del encabezado", () => {
    const out = ensureSingleH1(page('<section><h2><span class="k">Marca</span> viva</h2></section>'));
    expect(out.html).toContain('<h1><span class="k">Marca</span> viva</h1>');
  });

  it("es idempotente", () => {
    const once = ensureSingleH1(page("<section><h1>A</h1></section><section><h1>B</h1></section>"));
    expect(ensureSingleH1(once.html)).toEqual({ html: once.html, changed: false });
  });
});
