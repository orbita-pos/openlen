import { describe, it, expect } from "vitest";
import { validateBehaviors } from "./validate";
import type { Behavior, BehaviorName } from "./types";

const REG = {
  countdown: {
    name: "countdown", marker: "data-ol-countdown", js: "", budgetBytes: 700,
    schema: {
      root: { kind: "isoDate" },
      parts: [{ selector: "[data-ol-cd]", min: 1, why: "sin un hijo [data-ol-cd] no hay dónde escribir el tiempo" }],
    },
    degradation: "control-inert", a11y: [], status: "stable",
    doc: { when: "", whenNot: "", example: "" },
  },
  copy: {
    name: "copy", marker: "data-ol-copy", js: "", budgetBytes: 700,
    schema: { root: { kind: "idRef" } },
    degradation: "content-intact", a11y: [], status: "stable",
    doc: { when: "", whenNot: "", example: "" },
  },
  autoplay: {
    name: "autoplay", marker: "data-ol-autoplay", js: "", budgetBytes: 700,
    schema: { root: { kind: "ms", min: 1500 }, requiresHost: "[data-ol-row]" },
    degradation: "content-intact", a11y: [], status: "stable",
    doc: { when: "", whenNot: "", example: "" },
  },
} as unknown as Partial<Record<BehaviorName, Behavior>>;

const doc = (body: string) => `<!doctype html><html><body>${body}</body></html>`;

describe("validateBehaviors — el valor del atributo raíz", () => {
  it("acepta una fecha ISO", () => {
    const html = doc(`<div data-ol-countdown="2026-08-15T20:00-06:00"><span data-ol-cd="days">0</span></div>`);
    expect(validateBehaviors(html, REG)).toEqual([]);
  });
  it("rechaza '15 de agosto'", () => {
    const html = doc(`<div data-ol-countdown="15 de agosto"><span data-ol-cd="days">0</span></div>`);
    const issues = validateBehaviors(html, REG);
    expect(issues).toHaveLength(1);
    expect(issues[0].behavior).toBe("countdown");
    expect(issues[0].message).toMatch(/fecha/i);
  });
  it("rechaza un ms por debajo del mínimo", () => {
    const html = doc(`<div data-ol-row data-ol-autoplay="200"></div>`);
    const issues = validateBehaviors(html, REG);
    expect(issues.some((i) => i.behavior === "autoplay")).toBe(true);
  });
});

describe("validateBehaviors — la estructura", () => {
  it("caza un countdown sin ningún [data-ol-cd] (no habría dónde escribir)", () => {
    const html = doc(`<div data-ol-countdown="2026-08-15T20:00Z"></div>`);
    const issues = validateBehaviors(html, REG);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/data-ol-cd/);
  });
  it("caza un copy que apunta a un id inexistente (boton muerto)", () => {
    const html = doc(`<button data-ol-copy="cupon">Copiar</button>`);
    const issues = validateBehaviors(html, REG);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/cupon/);
  });
  it("acepta un copy cuyo id existe", () => {
    const html = doc(`<code id="cupon">TACOS20</code><button data-ol-copy="cupon">Copiar</button>`);
    expect(validateBehaviors(html, REG)).toEqual([]);
  });
  it("caza un autoplay que no vive sobre un [data-ol-row]", () => {
    const html = doc(`<div data-ol-autoplay="5000"></div>`);
    const issues = validateBehaviors(html, REG);
    expect(issues.some((i) => /data-ol-row/.test(i.message))).toBe(true);
  });
});

describe("validateBehaviors — silencio cuando no hay conductas", () => {
  it("una pagina sin marcadores no produce ningun issue", () => {
    expect(validateBehaviors(doc(`<p>hola</p>`), REG)).toEqual([]);
  });
});
