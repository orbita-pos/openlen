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

// IMPORTANT (revisión final de rama) — el guard viejo era
// `html.includes(BEHAVIORS_MARKER)`: un substring SUELTO sobre TODO el
// documento, no "¿existe ya el <script> real?". Probado con el sanitizer
// real, los 4 vectores de abajo sobreviven y en los 4 el guard viejo daba
// `true` sin que ningún <script data-ol-behaviors> existiera — bakeBehaviors
// hacía bail-out creyendo que ya estaba horneado, PARA SIEMPRE (ninguna
// receta con marcador legítimo volvía a inyectarse en esa página), mientras
// usedBehaviors() (que mira el marcador de CADA receta, no BEHAVIORS_MARKER)
// seguía reportando la conducta como "usada" — la telemetría mentía. El fix
// es mirar el TAG literal (`<script ${BEHAVIORS_MARKER}>`).
describe("bakeBehaviors — el guard no confunde el marcador SUELTO con el <script> real (4 vectores)", () => {
  const withCountdown = (extra: string) =>
    `<!doctype html><html><head></head><body>${extra}<div data-ol-countdown="x"></div></body></html>`;

  it("(A) un <style data-ol-behaviors> residual (sin el <script>) no bloquea un bake nuevo", () => {
    const html = withCountdown(`<style ${BEHAVIORS_MARKER}>.leftover{}</style>`);
    const out = bakeBehaviors(html, REG, ORDER);
    expect(out).toContain(`<script ${BEHAVIORS_MARKER}>`);
    expect(out).toContain("/*CD*/");
  });

  it("(B) la cadena dentro de un comentario HTML no bloquea un bake nuevo", () => {
    const html = withCountdown(`<!-- nota interna: ${BEHAVIORS_MARKER} -->`);
    const out = bakeBehaviors(html, REG, ORDER);
    expect(out).toContain(`<script ${BEHAVIORS_MARKER}>`);
  });

  it("(C) la cadena en texto visible (una página que habla del propio marcador) no bloquea un bake nuevo", () => {
    const html = withCountdown(`<p>Esta demo usa el atributo ${BEHAVIORS_MARKER} para su runtime.</p>`);
    const out = bakeBehaviors(html, REG, ORDER);
    expect(out).toContain(`<script ${BEHAVIORS_MARKER}>`);
  });

  it("(D) una regla CSS del autor [data-ol-behaviors]{} no bloquea un bake nuevo", () => {
    const html = withCountdown(`<style>[${BEHAVIORS_MARKER}]{outline:1px solid red}</style>`);
    const out = bakeBehaviors(html, REG, ORDER);
    expect(out).toContain(`<script ${BEHAVIORS_MARKER}>`);
  });

  it("usedBehaviors() y el bake real quedan de acuerdo — ya no hay telemetría mentirosa", () => {
    const html = withCountdown(`<!-- ${BEHAVIORS_MARKER} -->`);
    expect(usedBehaviors(html, REG, ORDER)).toEqual(["countdown"]);
    expect(bakeBehaviors(html, REG, ORDER)).toContain(`<script ${BEHAVIORS_MARKER}>`);
  });

  it("sigue siendo idempotente sobre un documento YA horneado de verdad", () => {
    const html = withCountdown("");
    const once = bakeBehaviors(html, REG, ORDER);
    expect(bakeBehaviors(once, REG, ORDER)).toBe(once);
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
