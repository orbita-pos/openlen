// El arnés. Corre sobre TODA entrada del registro. Anadir la conducta #20 = una
// entrada; ESTE archivo demuestra que es correcta, documentada, accesible,
// dentro de presupuesto y que degrada sin romper — o el CI falla.
import { describe, it, expect } from "vitest";
import { BEHAVIORS, BEHAVIOR_ORDER } from "./registry";
import { buildBehaviorsScript } from "./build";
import { validateBehaviors } from "./validate";
import { trackDocumentListeners } from "./recipes/test-helpers";
import type { Behavior, BehaviorName } from "./types";

// BEHAVIORS[n] is `Behavior | undefined` (Partial record) — a bare
// `.filter(Boolean)` calls the ambient `Boolean` global, whose lib.d.ts
// signature is `(value?: any) => boolean`, not a type predicate, so it can't
// narrow. An explicit predicate is what actually drops `undefined` from the
// type (not just the runtime array), which strict mode requires downstream
// in every describe.each case below.
const entries = BEHAVIOR_ORDER.map((n) => BEHAVIORS[n]).filter((b): b is Behavior => b !== undefined);
// 4096 (el valor original) era incoherente con el propio contrato: el
// presupuesto POR RECETA es 700B (ver budgetBytes en cada recipes/*.ts) y
// BEHAVIOR_ORDER tiene 7 recetas, así que el peor caso legítimo por JS solo
// ya es 7×700=4900B — MÁS que el techo global, antes de sumar un solo byte
// de overhead. El techo nunca fue alcanzable con las 7 recetas usando el
// presupuesto que su propio contrato les concede; los dos números se
// contradecían entre sí, no es que nos estuviéramos apretando a propósito.
// Cota superior real hoy (medida, no adivinada): 7×700B (recetas) + ~145B
// (EDIT_GUARD_JS) + ~82B (el inyector de <style> fijo, sin contar el CSS que
// inyecta) + 8×17B (wrappers IIFE: 1 exterior + 1 por receta, build.ts) +
// el CSS de las recetas (280B ya en filter+lightbox, más lo que aporten
// autoplay/theme/sticky) ≈ 5.4KB. 6144B (6KB) lo cubre con margen y SIGUE
// siendo un techo real, no una barra libre.
// El gate de verdad no es este número: es Lighthouse 100 sobre una página
// publicada con las 7 recetas (Task 14, E2E). 6KB de JS inline no mueve la
// aguja de Lighthouse — el techo existe para que el bloat no crezca EN
// SILENCIO, no porque 4096 (ni 6144) fueran un límite físico.
// El presupuesto POR RECETA (700B) NO se toca aquí: ese es el verdadero
// mecanismo de disciplina, y las 4 recetas ya enviadas (631-685B) prueban
// que es alcanzable sin sacrificar comportamiento.
const TOTAL_BUDGET = 6144;

/** Registro falso mínimo — no hace falta una segunda receta real para probar
 *  que el arnés compone y aísla correctamente. Mismo patrón que
 *  build.test.ts::fake() y use-behaviors-preview.test.ts::fake(). */
function fakeBehavior(name: BehaviorName, marker: string, js: string): Behavior {
  return {
    name, marker, js, budgetBytes: 4096,
    schema: { root: { kind: "flag" } },
    degradation: "content-intact", a11y: [], status: "stable",
    doc: { when: "", whenNot: "", example: "" },
  } as Behavior;
}

describe("conformidad del registro", () => {
  it("toda receta registrada está en BEHAVIOR_ORDER (si no, nunca se emitiría)", () => {
    // Subconjunto, no igualdad: durante la Fase 2 el registro se llena receta a
    // receta. El Task 13 (última receta) añade la comprobación de completitud.
    for (const k of Object.keys(BEHAVIORS)) {
      expect(BEHAVIOR_ORDER, `"${k}" está en BEHAVIORS pero no en BEHAVIOR_ORDER`).toContain(k);
    }
  });

  it("el script COMPUESTO real (guard + estilos + wrappers) cabe en el presupuesto global", () => {
    // Sumar los `b.js` sueltos (como hacía esta prueba antes) no mide lo que
    // de verdad pesa la página: se salta EDIT_GUARD_JS, el inyector de
    // estilos y el wrapper de aislamiento por receta (build.ts, Fallo 1)
    // — ninguno de esos bytes es cero. Se compone el script REAL con
    // buildBehaviorsScript sobre un HTML que trae el ejemplo de TODAS las
    // recetas registradas a la vez (el peor caso: una página que usa las 7),
    // y se mide ESE string — es el único número que corresponde a lo que
    // llega al navegador.
    const html = `<!doctype html><html><body>${entries.map((b) => b.doc.example).join("")}</body></html>`;
    const script = buildBehaviorsScript(html);
    expect(script).not.toBeNull();
    // Buffer.byteLength (bytes UTF-8), no .length (unidades UTF-16): da igual
    // hoy porque todo es ASCII, pero una comilla tipográfica o un emoji en
    // una receta futura haría que este número mintiera más barato de lo que
    // realmente pesa.
    const bytes = Buffer.byteLength(script!, "utf8");
    const margin = TOTAL_BUDGET - bytes;
    expect(bytes, `script compuesto real: ${bytes}B de ${TOTAL_BUDGET}B — margen ${margin}B`)
      .toBeLessThanOrEqual(TOTAL_BUDGET);
  });
});

// Fallo 1 (aislamiento por receta) es invisible para CI si nada COMPONE y
// EJECUTA un script con 2+ recetas — un `.toContain()` (como usan los tests
// de arriba) no lo cazaría: un `var x` pisado sigue apareciendo íntegro en el
// substring, el bug solo se manifiesta al CORRER el script compuesto. No hace
// falta esperar a que exista una segunda receta real: un registro FALSO con
// dos que colisionarían sin aislamiento basta, y de paso queda como guard
// permanente contra que alguien revierta el wrapper de build.ts.
describe("aislamiento entre recetas (Fallo 1)", () => {
  trackDocumentListeners();

  it("dos recetas con `var` a nivel superior conservan CADA UNA su propio valor", () => {
    // Cada fake declara `var x` a nivel superior — como haría cualquier
    // receta descuidada — y solo LEE `x` dentro de un listener que se
    // dispara DESPUÉS de que el script compuesto entero terminó de correr.
    // Sin aislamiento, las dos `var x` comparten UN binding (mismo scope de
    // función: todas las recetas se concatenaban dentro de la misma IIFE
    // exterior), así que al momento del evento AMBOS listeners verían el
    // valor de la ÚLTIMA receta que corrió (2), nunca el de la primera. Con
    // cada receta en su propia IIFE interior (build.ts), cada listener
    // cierra sobre SU `x` — exactamente lo que este test comprueba.
    const collideA = fakeBehavior(
      "countdown",
      "data-ol-test-collide-a",
      `var x=1;document.addEventListener('ol-test-collide',function(){document.body.setAttribute('data-x-a',String(x))});`,
    );
    const collideB = fakeBehavior(
      "filter",
      "data-ol-test-collide-b",
      `var x=2;document.addEventListener('ol-test-collide',function(){document.body.setAttribute('data-x-b',String(x))});`,
    );
    const reg = { countdown: collideA, filter: collideB } as Partial<Record<BehaviorName, Behavior>>;
    const order: BehaviorName[] = ["countdown", "filter"];
    const html = `<div data-ol-test-collide-a></div><div data-ol-test-collide-b></div>`;

    const script = buildBehaviorsScript(html, reg, order);
    expect(script).not.toBeNull();

    document.body.innerHTML = "";
    try {
      // eslint-disable-next-line no-new-func
      new Function(script!)();   // solo en el TEST — igual que recipes/test-helpers.ts::mount()
      document.dispatchEvent(new Event("ol-test-collide"));

      expect(
        document.body.getAttribute("data-x-a"),
        "receta A perdió su propio `x` — el aislamiento del Fallo 1 se rompió",
      ).toBe("1");
      expect(
        document.body.getAttribute("data-x-b"),
        "receta B perdió su propio `x` — el aislamiento del Fallo 1 se rompió",
      ).toBe("2");
    } finally {
      document.body.innerHTML = "";
    }
  });
});

describe.each(entries.map((b) => [b.name, b] as const))("conducta: %s", (_name, b) => {
  it("respeta su presupuesto de bytes", () => {
    // Buffer.byteLength (bytes UTF-8), no .length (unidades UTF-16) — misma
    // razón que el presupuesto global, ver más abajo.
    const bytes = Buffer.byteLength(b.js, "utf8");
    expect(bytes, `${b.name}: ${bytes}B > ${b.budgetBytes}B`)
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

  it("si promete content-intact, montado con su css y SIN ejecutar su runtime, ningún elemento del ejemplo nace oculto", () => {
    if (b.degradation !== "content-intact") return;
    // Invariante COMPUTADO, no textual: escanear el string del ejemplo (como
    // hacía esta prueba antes) se salta cualquier ocultamiento que llegue vía
    // b.css — ej. ".ol-cd-init{opacity:0}" sobre una clase que el ejemplo usa
    // pasaba en verde. Montamos ejemplo+css en el DOM, SIN correr b.js (el
    // runtime está apagado a propósito — eso es lo que "sin runtime" simula),
    // y leemos el estilo YA calculado. Esto es lo que deja pasar a `filter`
    // legítimamente: su css es "[data-ol-hidden]{display:none!important}",
    // pero ningún elemento del ejemplo lleva ese atributo — solo el runtime
    // lo pone, tras un click — así que no oculta a nadie.
    document.head.innerHTML = `<style>${b.css ?? ""}</style>`;
    document.body.innerHTML = b.doc.example;
    try {
      for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
        const style = getComputedStyle(el);
        const culprit = `${b.name}: ${el.outerHTML.slice(0, 120)}`;
        expect(style.display, `${culprit} — nace con display:none sin runtime`).not.toBe("none");
        expect(style.opacity, `${culprit} — nace con opacity:0 sin runtime`).not.toBe("0");
        expect(el.hasAttribute("hidden"), `${culprit} — nace con [hidden] sin runtime`).toBe(false);
      }
    } finally {
      document.head.innerHTML = "";
      document.body.innerHTML = "";
    }
  });

  it("no usa eval, new Function ni innerHTML con datos de atributos", () => {
    expect(b.js).not.toMatch(/\beval\s*\(/);
    expect(b.js).not.toMatch(/new\s+Function/);
    expect(b.js).not.toMatch(/\.innerHTML\s*=/);
  });

  // Guard estático y débil (busca el fragmento, no ejecuta nada) — a propósito:
  // caza exactamente la regresión que ya se coló CUATRO veces (clearInterval de
  // countdown, try/catch de execCommand en copy, el arnés de degradación que
  // escaneaba texto en vez de computar estilo, y el clearInterval de autoplay
  // — ver progress.md, "LECCIÓN ESTRUCTURAL"). Un test que solo comprueba el
  // EFECTO (ej. "scrollBy no se llamó") pasa en verde si alguien muta el
  // mecanismo de parada a un simple flag que hace que el tick retorne
  // temprano — el setInterval sigue vivo, gastando un tick por intervalo para
  // siempre en una página publicada que el visitante puede dejar abierta
  // horas. Un flag que finge parar NO es limpiar. Esta prueba vive en el
  // ARNÉS (no en cada recipes/*.test.ts) para que la próxima receta con
  // setInterval la herede gratis, sin depender de que su implementer recuerde
  // escribirla a mano.
  it("si su runtime usa setInterval, TAMBIÉN usa clearInterval (un flag que finge parar no es limpiar)", () => {
    if (!b.js.includes("setInterval")) return;
    expect(
      b.js,
      `${b.name}: usa setInterval pero su js no contiene "clearInterval" — un intervalo que nunca se limpia es una fuga real en una página que puede quedar abierta horas; un flag que hace que el tick retorne temprano no cuenta como limpiar`,
    ).toMatch(/clearInterval/);
  });

  it("documenta cuándo NO usarse (una receta sin whenNot invita a usarla mal)", () => {
    expect(b.doc.when.length).toBeGreaterThan(10);
    expect(b.doc.whenNot.length).toBeGreaterThan(10);
  });

  it("si declara `untrusted`, su runtime revalida el esquema en el sink", () => {
    // El spec exige que un atributo `untrusted` (su valor acaba en un sink
    // del DOM — el href del lightbox en un img.src) se revalide en el
    // RUNTIME, porque el sanitizer es una capa y no la única. Sin esta
    // aserción nada estructural lo obliga: una receta futura podría declarar
    // `untrusted` y olvidar la comprobación, y el arnés no se enteraría hasta
    // que alguien lo explotara en producción. La regex es deliberadamente
    // débil (busca el fragmento `https?`, no reimplementa un parser) porque
    // el objetivo es obligar a que EXISTA alguna validación de esquema en el
    // js — que sea correcta ya lo cubre el test de seguridad propio de cada
    // receta (ver lightbox.test.ts, caso "SEGURIDAD").
    if (!b.schema.untrusted || b.schema.untrusted.length === 0) return;
    expect(
      b.js,
      `${b.name}: declara untrusted:[${b.schema.untrusted.join(",")}] pero su js no revalida el esquema (falta el fragmento "https?") — el sanitizer es una capa, no la única`,
    ).toMatch(/https?/);
  });
});
