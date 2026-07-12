import { describe, it, expect } from "vitest";
import { injectBehaviorsPreview } from "./use-behaviors-preview";
import { bakeBehaviors } from "@/lib/behaviors/build";
import type { Behavior, BehaviorName } from "@/lib/behaviors/types";

const doc = (body: string) => `<!doctype html><html><head></head><body>${body}</body></html>`;

// Registro falso — el real (lib/behaviors/registry.ts) sigue vacío en F1 (las
// recetas llegan en F2), así que probar contra él no afirmaría nada. Mismo
// patrón exacto que lib/behaviors/build.test.ts.
const fake = (name: string, marker: string, js: string, headJs?: string): Behavior =>
  ({
    name: name as BehaviorName, marker, js, headJs, budgetBytes: 700,
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
