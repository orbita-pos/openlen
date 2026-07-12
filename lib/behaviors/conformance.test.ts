// El arnés. Corre sobre TODA entrada del registro. Anadir la conducta #20 = una
// entrada; ESTE archivo demuestra que es correcta, documentada, accesible,
// dentro de presupuesto y que degrada sin romper — o el CI falla.
import { describe, it, expect } from "vitest";
import { BEHAVIORS, BEHAVIOR_ORDER } from "./registry";
import { buildBehaviorsScript } from "./build";
import { validateBehaviors } from "./validate";
import type { Behavior } from "./types";

// BEHAVIORS[n] is `Behavior | undefined` (Partial record) — a bare
// `.filter(Boolean)` calls the ambient `Boolean` global, whose lib.d.ts
// signature is `(value?: any) => boolean`, not a type predicate, so it can't
// narrow. An explicit predicate is what actually drops `undefined` from the
// type (not just the runtime array), which strict mode requires downstream
// in every describe.each case below.
const entries = BEHAVIOR_ORDER.map((n) => BEHAVIORS[n]).filter((b): b is Behavior => b !== undefined);
const TOTAL_BUDGET = 4096;

describe("conformidad del registro", () => {
  it("toda receta registrada está en BEHAVIOR_ORDER (si no, nunca se emitiría)", () => {
    // Subconjunto, no igualdad: durante la Fase 2 el registro se llena receta a
    // receta. El Task 13 (última receta) añade la comprobación de completitud.
    for (const k of Object.keys(BEHAVIORS)) {
      expect(BEHAVIOR_ORDER, `"${k}" está en BEHAVIORS pero no en BEHAVIOR_ORDER`).toContain(k);
    }
  });

  it("la suma de todos los runtimes cabe en el presupuesto global", () => {
    const total = entries.reduce((n, b) => n + b.js.length + (b.css?.length ?? 0), 0);
    expect(total, `runtime total ${total}B > ${TOTAL_BUDGET}B — Born-100 no se negocia`)
      .toBeLessThanOrEqual(TOTAL_BUDGET);
  });
});

describe.each(entries.map((b) => [b.name, b] as const))("conducta: %s", (_name, b) => {
  it("respeta su presupuesto de bytes", () => {
    expect(b.js.length, `${b.name}: ${b.js.length}B > ${b.budgetBytes}B`)
      .toBeLessThanOrEqual(b.budgetBytes);
  });

  it("el marcador coincide con el que el ejemplo usa", () => {
    expect(b.doc.example).toContain(b.marker);
  });

  it("su ejemplo VALIDA contra su propio schema (documentación que miente = CI rojo)", () => {
    const html = `<!doctype html><html><body>${b.doc.example}</body></html>`;
    expect(validateBehaviors(html)).toEqual([]);
  });

  it("su ejemplo mete su trozo en el runtime compuesto", () => {
    const html = `<!doctype html><html><body>${b.doc.example}</body></html>`;
    const script = buildBehaviorsScript(html);
    expect(script).not.toBeNull();
    expect(script!).toContain(b.js);
  });

  it("declara los ARIA que promete, y el ejemplo los lleva", () => {
    const dom = new DOMParser().parseFromString(
      `<!doctype html><html><body>${b.doc.example}</body></html>`, "text/html",
    );
    const root = dom.querySelector<HTMLElement>(`[${b.marker}]`)!;
    expect(root).not.toBeNull();
    for (const req of b.a11y) {
      const el = req.selector === ":root" ? root : root.querySelector(req.selector);
      expect(el, `${b.name}: el ejemplo no trae ${req.selector}`).not.toBeNull();
      expect(el!.hasAttribute(req.attr), `${b.name}: falta ${req.attr} en ${req.selector}`).toBe(true);
    }
  });

  it("si promete content-intact, su ejemplo NO oculta contenido sin runtime", () => {
    if (b.degradation !== "content-intact") return;
    // Sin el runtime, ningun elemento del ejemplo puede nacer oculto: ese es
    // exactamente el bug que mato a las plantillas (opacity:0 esperando un JS
    // que nunca llega).
    expect(b.doc.example).not.toMatch(/style="[^"]*display:\s*none/i);
    expect(b.doc.example).not.toMatch(/\bhidden\b(?!-)/);
    expect(b.doc.example).not.toMatch(/opacity:\s*0/i);
  });

  it("no usa eval, new Function ni innerHTML con datos de atributos", () => {
    expect(b.js).not.toMatch(/\beval\s*\(/);
    expect(b.js).not.toMatch(/new\s+Function/);
    expect(b.js).not.toMatch(/\.innerHTML\s*=/);
  });

  it("documenta cuándo NO usarse (una receta sin whenNot invita a usarla mal)", () => {
    expect(b.doc.when.length).toBeGreaterThan(10);
    expect(b.doc.whenNot.length).toBeGreaterThan(10);
  });
});
