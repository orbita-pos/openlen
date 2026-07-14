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

// Hallazgo Fable (2026-07-13): la cabecera de ESTE archivo promete cazar "un
// filtro que apunta a una rejilla inexistente" — su ejemplo literal — y no
// existía ningún check que cruzara el nombre del grupo con su target: un
// grupo entero de botones nacía muerto, en silencio. `crossRefs` es el
// vocabulario genérico que lo cubre (y que tabs, la receta #8, va a
// necesitar exactamente igual: grupo de pestañas ↔ sus paneles).
const FILTER_REG = {
  filter: {
    name: "filter", marker: "data-ol-filter", js: "", budgetBytes: 700,
    schema: {
      root: { kind: "tagList" },
      requiresHost: "[data-ol-filter-group]",
      crossRefs: [{
        via: "data-ol-filter-group",
        target: "data-ol-filter-target",
        why: "sin esa rejilla, los botones no filtran nada",
      }],
    },
    degradation: "content-intact", a11y: [], status: "stable",
    doc: { when: "", whenNot: "", example: "" },
  },
} as unknown as Partial<Record<BehaviorName, Behavior>>;

describe("validateBehaviors — crossRefs (grupo ↔ target en otra parte del documento)", () => {
  it("caza un grupo de filtros SIN su [data-ol-filter-target] — todos sus botones nacerían muertos", () => {
    const html = doc(
      `<div data-ol-filter-group="menu"><button data-ol-filter="*">Todo</button><button data-ol-filter="tacos">Tacos</button></div>`,
    );
    const issues = validateBehaviors(html, FILTER_REG);
    expect(issues, "UN issue por grupo — no uno por botón").toHaveLength(1);
    expect(issues[0].behavior).toBe("filter");
    expect(issues[0].message).toMatch(/data-ol-filter-target="menu"/);
  });
  it("acepta el grupo cuando su target existe", () => {
    const html = doc(
      `<div data-ol-filter-group="menu"><button data-ol-filter="*">Todo</button></div>` +
        `<div data-ol-filter-target="menu"><article data-ol-tag="tacos">x</article></div>`,
    );
    expect(validateBehaviors(html, FILTER_REG)).toEqual([]);
  });
  it("un botón fuera de todo grupo reporta requiresHost, no crossRefs (no hay valor que cruzar)", () => {
    const html = doc(`<button data-ol-filter="tacos">Tacos</button>`);
    const issues = validateBehaviors(html, FILTER_REG);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/data-ol-filter-group/);
  });
  it("dos grupos, uno con target y otro sin: solo el huérfano reporta", () => {
    const html = doc(
      `<div data-ol-filter-group="menu"><button data-ol-filter="*">Todo</button></div>` +
        `<div data-ol-filter-target="menu"></div>` +
        `<div data-ol-filter-group="galeria"><button data-ol-filter="*">Todo</button></div>`,
    );
    const issues = validateBehaviors(html, FILTER_REG);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/galeria/);
  });
});
