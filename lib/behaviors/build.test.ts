import { describe, it, expect } from "vitest";
import { buildBehaviorsScript, bakeBehaviors, BEHAVIORS_MARKER } from "./build";
import type { Behavior, BehaviorName } from "./types";

const fake = (name: string, marker: string, js: string): Behavior =>
  ({
    name: name as BehaviorName, marker, js, budgetBytes: 700,
    schema: { root: { kind: "flag" } },
    degradation: "content-intact", a11y: [], status: "stable",
    doc: { when: "", whenNot: "", example: "" },
  }) as Behavior;

const REG = {
  countdown: fake("countdown", "data-ol-countdown", "/*CD*/"),
  filter: fake("filter", "data-ol-filter", "/*FI*/"),
} as Partial<Record<BehaviorName, Behavior>>;
const ORDER: BehaviorName[] = ["countdown", "filter"];

describe("buildBehaviorsScript", () => {
  it("devuelve null cuando la página no usa ninguna conducta", () => {
    expect(buildBehaviorsScript("<p>hola</p>", REG, ORDER)).toBeNull();
  });
  it("incluye SOLO el trozo cuyo marcador está presente", () => {
    const out = buildBehaviorsScript(`<div data-ol-countdown="x"></div>`, REG, ORDER)!;
    expect(out).toContain("/*CD*/");
    expect(out).not.toContain("/*FI*/");
  });
  it("emite en el orden del REGISTRO, no en el de aparición (hash CSP estable)", () => {
    const html = `<div data-ol-filter="a"></div><div data-ol-countdown="x"></div>`;
    const out = buildBehaviorsScript(html, REG, ORDER)!;
    expect(out.indexOf("/*CD*/")).toBeLessThan(out.indexOf("/*FI*/"));
  });
});

describe("bakeBehaviors", () => {
  it("inyecta el script antes de </body>", () => {
    const html = `<html><body><div data-ol-countdown="x"></div></body></html>`;
    const out = bakeBehaviors(html, REG, ORDER);
    expect(out).toContain(BEHAVIORS_MARKER);
    expect(out.indexOf(BEHAVIORS_MARKER)).toBeLessThan(out.indexOf("</body>"));
  });
  it("es idempotente — un segundo bake no duplica nada", () => {
    const html = `<html><body><div data-ol-countdown="x"></div></body></html>`;
    const once = bakeBehaviors(html, REG, ORDER);
    expect(bakeBehaviors(once, REG, ORDER)).toBe(once);
  });
  it("no toca una página sin conductas", () => {
    const html = `<html><body><p>hola</p></body></html>`;
    expect(bakeBehaviors(html, REG, ORDER)).toBe(html);
  });
});
