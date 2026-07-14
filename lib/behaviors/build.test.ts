import { describe, it, expect } from "vitest";
import { buildBehaviorsScript, buildBehaviorsHead, bakeBehaviors, BEHAVIORS_MARKER, usedBehaviors } from "./build";
import type { Behavior, BehaviorName } from "./types";

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

describe("inyección en <head> (headJs)", () => {
  const REG_HEAD = {
    theme: fake("theme", "data-ol-theme", "/*BODY*/", "/*HEAD*/"),
  } as Partial<Record<BehaviorName, Behavior>>;
  const ORDER_HEAD: BehaviorName[] = ["theme"];

  it("con </head> presente, el script del head va antes de </head>", () => {
    const html = `<!DOCTYPE html><html><head></head><body><div data-ol-theme="x"></div></body></html>`;
    const out = bakeBehaviors(html, REG_HEAD, ORDER_HEAD);
    expect(out).toContain("/*HEAD*/");
    expect(out.indexOf("/*HEAD*/")).toBeLessThan(out.indexOf("</head>"));
  });

  it("sin </head> pero con <!DOCTYPE html>, el doctype sigue siendo lo primero del documento", () => {
    const html = `<!DOCTYPE html><html><body><div data-ol-theme="x"></div></body></html>`;
    const out = bakeBehaviors(html, REG_HEAD, ORDER_HEAD);
    expect(out.trimStart().startsWith("<!DOCTYPE")).toBe(true);
    expect(out).toContain("/*HEAD*/");
  });

  it("buildBehaviorsHead: IIFE envuelto si hay headJs, null si ninguna conducta lo tiene", () => {
    const html = `<div data-ol-theme="x"></div>`;
    expect(buildBehaviorsHead(html, REG_HEAD, ORDER_HEAD)).toBe("(function(){/*HEAD*/})();");
    expect(buildBehaviorsHead(`<div data-ol-countdown="x"></div>`, REG, ORDER)).toBeNull();
  });
});

describe("usedBehaviors", () => {
  it("devuelve los nombres en orden de REGISTRO, no de aparición en el HTML", () => {
    const reg = {
      countdown: fake("countdown", "data-ol-countdown", "/*CD*/"),
      copy: fake("copy", "data-ol-copy", "/*CP*/"),
    } as Partial<Record<BehaviorName, Behavior>>;
    const order: BehaviorName[] = ["countdown", "copy"];
    // El marcador de "copy" aparece ANTES que el de "countdown" en el HTML —
    // si usedBehaviors escaneara por orden de aparición devolvería
    // ["copy", "countdown"]. present() itera BEHAVIOR_ORDER, así que debe
    // devolver ["countdown", "copy"] pase lo que pase en el string.
    const html = `<button data-ol-copy="x"></button><div data-ol-countdown="y"></div>`;
    expect(usedBehaviors(html, reg, order)).toEqual(["countdown", "copy"]);
  });

  it("devuelve [] cuando la página no usa ninguna conducta", () => {
    const reg = {
      countdown: fake("countdown", "data-ol-countdown", "/*CD*/"),
      copy: fake("copy", "data-ol-copy", "/*CP*/"),
    } as Partial<Record<BehaviorName, Behavior>>;
    expect(usedBehaviors("<p>hola, nada aquí</p>", reg, ["countdown", "copy"])).toEqual([]);
  });

  it("una receta status: \"deprecated\" no aparece — usedBehaviors hereda el filtro de present()", () => {
    const reg = {
      countdown: fake("countdown", "data-ol-countdown", "/*CD*/"),
      filter: { ...fake("filter", "data-ol-filter", "/*FI*/"), status: "deprecated" as const },
    } as Partial<Record<BehaviorName, Behavior>>;
    const html = `<div data-ol-countdown="x"></div><div data-ol-filter="y"></div>`;
    expect(usedBehaviors(html, reg, ["countdown", "filter"])).toEqual(["countdown"]);
  });
});
