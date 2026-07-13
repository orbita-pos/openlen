import { describe, it, expect } from "vitest";
import { describeBehaviorIssues, validateBehaviors } from "./validate";
import type { Behavior, BehaviorName, BehaviorIssue } from "./types";

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

// Fixture del futuro `lightbox` (Hallazgo 1 de la revisión): el caso real que
// motiva requiredAttrs. Sin él, un <a data-ol-lightbox> sin href pasaba el
// validador y nacía muerto — la degradación declarada de lightbox es "sin
// runtime, el <a> abre la foto por sí solo", y un <a> sin href no abre nada.
const LIGHTBOX_REG = {
  lightbox: {
    name: "lightbox", marker: "data-ol-lightbox", js: "", budgetBytes: 700,
    schema: { root: { kind: "flag" }, requiredAttrs: ["href"], untrusted: ["href"] },
    degradation: "content-intact", a11y: [], status: "stable",
    doc: { when: "", whenNot: "", example: "" },
  },
} as unknown as Partial<Record<BehaviorName, Behavior>>;

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

describe("validateBehaviors — requiredAttrs + la rama untrusted (href de un <a data-ol-lightbox>)", () => {
  it("caza un href ausente por completo — Hallazgo 1: hoy esto NO se caza (issues: [])", () => {
    const html = doc(`<a data-ol-lightbox>foto</a>`);
    const issues = validateBehaviors(html, LIGHTBOX_REG);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/falta el atributo href/);
  });
  it("caza un href presente pero vacío (falla el regex http(s))", () => {
    const html = doc(`<a data-ol-lightbox href="">foto</a>`);
    const issues = validateBehaviors(html, LIGHTBOX_REG);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/https?:\/\//);
  });
  it("caza un href javascript: (no http/https)", () => {
    const html = doc(`<a data-ol-lightbox href="javascript:alert(1)">foto</a>`);
    const issues = validateBehaviors(html, LIGHTBOX_REG);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/javascript:alert\(1\)/);
  });
  it("acepta un href https válido — cero issues", () => {
    const html = doc(`<a data-ol-lightbox href="https://images.openlen.com/x.jpg">foto</a>`);
    expect(validateBehaviors(html, LIGHTBOX_REG)).toEqual([]);
  });
});

// Arreglo 2 (revisión final de rama) — describeBehaviorIssues es el "join"
// compartido entre lib/agent/tools.ts (canal `aviso` del agente) y
// app/api/templates/ai-design/route.ts (Chat), para que un tercer sitio
// nunca reimplemente su propia concatenación de mensajes.
describe("describeBehaviorIssues", () => {
  it("sin issues, devuelve undefined (nada que decir)", () => {
    expect(describeBehaviorIssues([])).toBeUndefined();
  });

  it("une los mensajes de varios issues con ' · ', en orden", () => {
    const issues: BehaviorIssue[] = [
      { behavior: "copy", message: "primero" },
      { behavior: "countdown", message: "segundo" },
    ];
    expect(describeBehaviorIssues(issues)).toBe("primero · segundo");
  });

  it("un solo issue no lleva separador", () => {
    expect(describeBehaviorIssues([{ behavior: "copy", message: "único" }])).toBe("único");
  });
});
