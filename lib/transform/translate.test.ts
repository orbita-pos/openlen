import { describe, it, expect } from "vitest";
import { translateKnownPatterns } from "./translate";

const doc = (body: string) => `<!doctype html><html><head></head><body>${body}</body></html>`;

// Formas REALES del catálogo vivo (fixtures scratch/transform-fixtures/,
// 2026-07-14): heron lleva data-copy="<texto literal>" junto al <code> que
// muestra ese mismo texto; salon lleva botones .arch-filter[data-tag] + un
// grid #archive-grid cuyos items (post-bake) llevan data-tag; choir esconde
// paneles id="tab-<val>" con la clase `hidden`.
describe("translateKnownPatterns — copy (data-copy literal → data-ol-copy por id)", () => {
  it("traduce el botón cuyo texto literal coincide con un vecino <code>", () => {
    const html = doc(
      `<div><code>npm install heron</code>` +
        `<button class="copy-btn" data-copy="npm install heron" aria-label="Copy">⧉</button></div>`,
    );
    const out = translateKnownPatterns(html);
    expect(out.translated).toContain("copy");
    expect(out.html).toMatch(/<code id="ol-copy-0">npm install heron<\/code>/);
    expect(out.html).toMatch(/data-ol-copy="ol-copy-0"/);
    expect(out.html).toMatch(/data-ol-copied="¡Copiado!"/);
    expect(out.html).not.toMatch(/\sdata-copy=/);
  });
  it("respeta un id existente del target en vez de inventar uno", () => {
    const html = doc(
      `<div><code id="cmd">npx openlen</code><button data-copy="npx openlen">⧉</button></div>`,
    );
    const out = translateKnownPatterns(html);
    expect(out.html).toMatch(/data-ol-copy="cmd"/);
    expect(out.html).not.toContain("ol-copy-0");
  });
  it("sin vecino cuyo texto coincida EXACTO → NO traduce (lista blanca estricta)", () => {
    const html = doc(`<div><code>otra cosa</code><button data-copy="npm install heron">⧉</button></div>`);
    const out = translateKnownPatterns(html);
    expect(out.html).not.toContain("data-ol-copy");
    expect(out.html).toContain('data-copy="npm install heron"');
  });
});

describe("translateKnownPatterns — filter (data-tag → data-ol-filter/*)", () => {
  const SALON = doc(
    `<div class="filters">` +
      `<button class="arch-filter active chip" data-tag="all">Todo</button>` +
      `<button class="arch-filter chip" data-tag="systems">Sistemas</button>` +
      `<button class="arch-filter chip" data-tag="people">Personas</button>` +
      `</div>` +
      `<div id="archive-grid" class="grid">` +
      `<article data-tag="systems">A</article>` +
      `<article data-tag="people">B</article>` +
      `<article data-tag="systems people">C</article>` +
      `</div>`,
  );
  it("traduce grupo completo: group/filter/target/tag + aria-pressed sembrado", () => {
    const out = translateKnownPatterns(SALON);
    expect(out.translated).toContain("filter");
    expect(out.html).toMatch(/data-ol-filter-group="archive-grid"/);
    expect(out.html).toMatch(/data-ol-filter="\*"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*data-ol-filter="\*"/);
    expect(out.html).toMatch(/data-ol-filter="systems"/);
    expect(out.html).toMatch(/data-ol-filter-target="archive-grid"/);
    expect(out.html).toMatch(/<article data-tag="systems" data-ol-tag="systems">/);
  });
  it("si a los items les FALTA algún tag de los botones → NO traduce", () => {
    const html = doc(
      `<div><button data-tag="all">T</button><button data-tag="fantasma">F</button></div>` +
        `<div id="g"><article data-tag="real">A</article></div>`,
    );
    const out = translateKnownPatterns(html);
    expect(out.html).not.toContain("data-ol-filter");
  });
  it("idempotencia: traducir lo ya traducido no duplica nada", () => {
    const once = translateKnownPatterns(SALON).html;
    const twice = translateKnownPatterns(once).html;
    expect(twice).toBe(once);
  });
});

describe("translateKnownPatterns — tabs (degradación honesta, sin marcador)", () => {
  it("si TODOS los paneles nacen hidden, destapa el primero; cuenta el inventario", () => {
    const html = doc(
      `<button data-tab="py" class="tab-btn">Py</button><button data-tab="js" class="tab-btn">JS</button>` +
        `<div id="tab-py" class="mt-2 hidden">pip install</div><div id="tab-js" class="mt-2 hidden">npm i</div>`,
    );
    const out = translateKnownPatterns(html);
    expect(out.tabsFound).toBe(2);
    expect(out.html).toMatch(/<div id="tab-py" class="mt-2">/);
    expect(out.html).toMatch(/<div id="tab-js" class="mt-2 hidden">/);
  });
  it("si el primer panel YA es visible (choir real), no toca nada", () => {
    const html = doc(
      `<button data-tab="py" class="tab-btn">Py</button>` +
        `<div id="tab-py">pip install</div><div id="tab-js" class="hidden">npm i</div>`,
    );
    const out = translateKnownPatterns(html);
    expect(out.html).toContain('<div id="tab-py">pip install</div>');
  });
});

describe("translateKnownPatterns — sin patrones", () => {
  it("página limpia vuelve intacta byte a byte", () => {
    const html = doc(`<h1>Hola</h1><button data-ol-copy="x">ya traducido</button><code id="x">v</code>`);
    const out = translateKnownPatterns(html);
    expect(out.html).toBe(html);
    expect(out.translated).toEqual([]);
  });
});
