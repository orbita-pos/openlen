import { describe, it, expect } from "vitest";
import { injectBehaviorsPreview } from "./use-behaviors-preview";
import { bakeBehaviors } from "@/lib/behaviors/build";
import type { Behavior, BehaviorName } from "@/lib/behaviors/types";
import { CAROUSEL_JS } from "@/lib/publish/carousel";

const doc = (body: string) => `<!doctype html><html><head></head><body>${body}</body></html>`;

// Registro falso — no el real (lib/behaviors/registry.ts, con las 7 recetas
// desde el Task 13): este archivo prueba paridad byte-a-byte de MECANISMO
// (aislamiento, wrapping, marcador) contra un registro controlado, no el
// contenido de cada receta real. Mismo patrón exacto que
// lib/behaviors/build.test.ts.
const fake = (name: string, marker: string, js: string, headJs?: string): Behavior =>
  ({
    name: name as BehaviorName, marker, js, headJs, budgetBytes: 700, docBudgetChars: 1200,
    schema: { root: { kind: "flag" } },
    degradation: "content-intact", a11y: [], status: "stable",
    doc: { when: "", whenNot: "", example: "" },
  }) as Behavior;

const REG = {
  countdown: fake("countdown", "data-ol-countdown", "/*CD*/"),
  filter: fake("filter", "data-ol-filter", "/*FI*/"),
} as Partial<Record<BehaviorName, Behavior>>;
const ORDER: BehaviorName[] = ["countdown", "filter"];

describe("injectBehaviorsPreview", () => {
  it("es byte-idéntico a bakeBehaviors para el mismo html + registro — la garantía de fuente única", () => {
    const html = doc(`<div data-ol-countdown="2026-08-15T20:00Z"><span data-ol-cd="days">0</span></div>`);
    expect(injectBehaviorsPreview(html, REG, ORDER)).toBe(bakeBehaviors(html, REG, ORDER));
  });

  it("con una conducta presente en el html, el runtime queda inyectado en la salida", () => {
    const html = doc(`<div data-ol-countdown="2026-08-15T20:00Z"></div>`);
    const out = injectBehaviorsPreview(html, REG, ORDER);
    expect(out).toContain("/*CD*/");
    expect(out).not.toBe(html);
  });

  it("una página sin ninguna conducta se devuelve intacta", () => {
    const html = doc(`<p>hola</p>`);
    expect(injectBehaviorsPreview(html, REG, ORDER)).toBe(html);
  });

  it("es idempotente", () => {
    const html = doc(`<div data-ol-countdown="2026-08-15T20:00Z"></div>`);
    const once = injectBehaviorsPreview(html, REG, ORDER);
    expect(injectBehaviorsPreview(once, REG, ORDER)).toBe(once);
  });
});

// Task 14b — el carrusel (lib/publish/carousel.ts) es la MISMA deuda que el
// comentario de use-behaviors-preview.ts describe, ya vencida una vez: el
// preview no inyectaba su runtime en absoluto (flechas muertas mientras
// editas, vivas al publicar). CAROUSEL_JS se importa aquí — no se copia — así
// que si alguien alguna vez reintroduce una copia divergente (a mano, por
// ejemplo dentro de injectBehaviorsPreview), este `toContain(CAROUSEL_JS)`
// deja de matchear y el test lo caza.
describe("injectBehaviorsPreview — carrusel (Task 14b)", () => {
  const carouselMarkup = `<div data-ol-row>
    <button data-ol-scroll="prev">‹</button>
    <button data-ol-scroll="next">›</button>
    <div data-ol-scroller><article>1</article><article>2</article></div>
  </div>`;

  it("un srcDoc con data-ol-scroll= recibe el runtime EXACTO que exporta carousel.ts", () => {
    const html = doc(carouselMarkup);
    const out = injectBehaviorsPreview(html);
    expect(out).toContain(CAROUSEL_JS);
  });

  it("un srcDoc sin data-ol-scroll= no lo inyecta", () => {
    const html = doc(`<div data-ol-countdown="2026-08-15T20:00Z"></div>`);
    const out = injectBehaviorsPreview(html);
    expect(out).not.toContain(CAROUSEL_JS);
  });

  it("es idempotente: inyectar dos veces no lo duplica", () => {
    const html = doc(carouselMarkup);
    const once = injectBehaviorsPreview(html);
    const twice = injectBehaviorsPreview(once);
    expect(twice).toBe(once);
  });

  it("la paridad no se rompe: un documento con conductas + carrusel recibe AMBOS runtimes", () => {
    const html = doc(`<div data-ol-countdown="2026-08-15T20:00Z"></div>${carouselMarkup}`);
    const out = injectBehaviorsPreview(html, REG, ORDER);
    expect(out).toContain("/*CD*/"); // la conducta (registro falso de este archivo)
    expect(out).toContain(CAROUSEL_JS); // el carrusel (fuente real, importada)
  });
});
