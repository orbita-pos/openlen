import { describe, it, expect } from "vitest";
import { injectBehaviorsPreview } from "./use-behaviors-preview";
import { bakeBehaviors } from "@/lib/behaviors/build";
import type { Behavior, BehaviorName } from "@/lib/behaviors/types";
import { CAROUSEL_JS, MARKER as CAROUSEL_MARKER, bakeCarousels } from "@/lib/publish/carousel";

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
    doc: { label: "", when: "", whenNot: "", example: "" },
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

  // IMPORTANT (revisión final de rama) — mismo bug de guard que bakeBehaviors
  // (lib/behaviors/build.ts, ver su propio test de los 4 vectores en
  // build.test.ts): injectCarouselPreview usaba
  // `html.includes(CAROUSEL_MARKER)` como substring SUELTO, que también da
  // `true` sin ningún <script> real detrás (aquí: un comentario HTML que
  // menciona el marcador) — apagaría este runtime para siempre, en silencio.
  it("una cadena suelta con el marcador (comentario HTML, sin <script> real) no bloquea la inyección", () => {
    const html = doc(`<!-- ${CAROUSEL_MARKER} -->${carouselMarkup}`);
    const out = injectBehaviorsPreview(html);
    expect(out).toContain(CAROUSEL_JS);
  });
});

// IMPORTANT (revisión final de rama) — bakeCarousels (lib/publish/carousel.ts)
// es el runtime de PUBLICACIÓN (no el del preview de arriba) y tenía el
// MISMO guard vulnerable: `html.includes(MARKER)` como substring suelto.
// Ningún archivo de test dedicado existe para lib/publish/carousel.ts (no
// está en el include de vitest.config.ts como glob — solo listado
// archivo-por-archivo — así que un `carousel.test.ts` nuevo se quedaría
// silenciosamente sin correr); se prueba aquí, que ya importa esa misma
// fuente para la paridad de arriba.
describe("bakeCarousels (lib/publish/carousel.ts) — mismo fix de guard que bakeBehaviors", () => {
  const carouselMarkup = `<div data-ol-row><button data-ol-scroll="prev">‹</button><button data-ol-scroll="next">›</button><div data-ol-scroller><article>1</article></div></div>`;

  it("un comentario HTML con el marcador (sin <script> real) no bloquea el bake de publicación", () => {
    const html = doc(`<!-- ${CAROUSEL_MARKER} -->${carouselMarkup}`);
    const out = bakeCarousels(html);
    expect(out).toContain(`<script ${CAROUSEL_MARKER}>`);
  });

  it("sigue siendo idempotente sobre un documento YA horneado de verdad", () => {
    const html = doc(carouselMarkup);
    const once = bakeCarousels(html);
    expect(bakeCarousels(once)).toBe(once);
  });

  // Arreglo 3 (revisión final de rama) — mismo bug de round-trip que
  // lib/behaviors/build.ts (ver su propio test en build.test.ts): el guard
  // miraba el TAG real pero como substring EXACTO
  // (`<script data-ol-carousel>`), que un round-trip de DOMParser+outerHTML
  // serializa como `<script data-ol-carousel="">` — un `.includes` de
  // substring exacto no matchea esa segunda forma, así que un re-bake sobre
  // HTML que pasó por ese round-trip duplicaría el <script>.
  it('un documento ya horneado, serializado como data-ol-carousel="" (round-trip DOMParser+outerHTML), no se vuelve a hornear', () => {
    const html = doc(carouselMarkup);
    const baked = bakeCarousels(html);
    const roundTripped =
      "<!doctype html>\n" + new DOMParser().parseFromString(baked, "text/html").documentElement.outerHTML;

    expect(roundTripped, "sanity: el round-trip debe DEJAR de traer el tag pelado").not.toContain(
      `<script ${CAROUSEL_MARKER}>`,
    );
    expect(roundTripped, "sanity: el round-trip debe producir la forma con =\"\"").toContain(
      `<script ${CAROUSEL_MARKER}="">`,
    );

    const rebaked = bakeCarousels(roundTripped);
    const scriptCount = (rebaked.match(new RegExp(`<script ${CAROUSEL_MARKER}`, "g")) ?? []).length;
    expect(
      scriptCount,
      `el round-trip de DOMParser no debe producir un segundo <script> de runtime (encontrados: ${scriptCount})`,
    ).toBe(1);
    expect(rebaked, "el guard tolerante al round-trip debe devolver el html sin tocar").toBe(roundTripped);
  });
});

// Hallazgo Fable (2026-07-13): el kill-switch era medio kill-switch — solo
// alcanzaba el bake de publish. Con `flags` el preview obedece la MISMA
// palanca (vía /api/flags → lib/publish/kill-switches.ts, el predicado único
// que filesystem.ts también consume): bajarla apaga las DOS mitades y editor
// y publicado no divergen por la propia palanca de rollback.
describe("injectBehaviorsPreview — flags (kill-switch alcanza al preview)", () => {
  it("behaviors:false NO inyecta el runtime de conductas aunque haya marcadores", () => {
    const html = `<!doctype html><html><body><div data-ol-countdown="2099-01-01T00:00Z"></div></body></html>`;
    const out = injectBehaviorsPreview(html, undefined, undefined, { behaviors: false, carousel: true });
    expect(out).toBe(html);
  });
  it("carousel:false NO inyecta el runtime del carrusel aunque haya data-ol-scroll", () => {
    const html = `<!doctype html><html><body><div data-ol-row><button data-ol-scroll="next">›</button><div data-ol-scroller></div></div></body></html>`;
    const out = injectBehaviorsPreview(html, undefined, undefined, { behaviors: true, carousel: false });
    expect(out).not.toContain(CAROUSEL_JS);
  });
  it("ambos apagados devuelve el html byte-idéntico; ausentes = ambos encendidos (default ON)", () => {
    const html = `<!doctype html><html><body><div data-ol-countdown="2099-01-01T00:00Z"></div><div data-ol-row><button data-ol-scroll="next">›</button><div data-ol-scroller></div></div></body></html>`;
    expect(injectBehaviorsPreview(html, undefined, undefined, { behaviors: false, carousel: false })).toBe(html);
    const on = injectBehaviorsPreview(html);
    expect(on).not.toBe(html);
    expect(on).toContain(CAROUSEL_JS);
  });
});
