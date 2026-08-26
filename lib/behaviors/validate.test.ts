import { describe, it, expect } from "vitest";
import {
  behaviorContractFingerprint,
  behaviorContractProjectionStats,
  describeBehaviorIssues,
  validateBehaviors,
} from "./validate";
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

const browserElement = (body: string, selector: string): Element => {
  const host = document.createElement("div");
  host.innerHTML = body;
  const element = host.querySelector(selector);
  if (!element) throw new Error(`fixture sin ${selector}`);
  return element;
};

describe("behaviorContractFingerprint — contrato conductual completo", () => {
  it("detecta una fórmula calc distinta aunque marker y conteo no cambien", () => {
    const a = doc('<div data-ol-calc><input data-ol-val="precio"><output data-ol-out="precio * 2">0</output></div>');
    const b = doc('<div data-ol-calc><input data-ol-val="precio"><output data-ol-out="precio * 3">0</output></div>');
    expect(behaviorContractFingerprint(a)).not.toBe(behaviorContractFingerprint(b));
  });

  it("detecta estado y valores/listas que calc consume", () => {
    const a = doc('<div data-ol-calc data-ol-state="paso = 1"><ul data-ol-val="precios"><li data-ol-item>10</li><li data-ol-item>20</li></ul><output data-ol-out="SUMA(precios)">30</output></div>');
    const b = doc('<div data-ol-calc data-ol-state="paso = 2"><ul data-ol-val="precios"><li data-ol-item>10</li><li data-ol-item>30</li></ul><output data-ol-out="SUMA(precios)">40</output></div>');
    expect(behaviorContractFingerprint(a)).not.toBe(behaviorContractFingerprint(b));
  });

  it("detecta la opción inicial que un select calc entrega como value", () => {
    const a = doc('<div data-ol-calc><select data-ol-val="plan"><option value="basico" selected>Básico</option><option value="pro">Pro</option></select><output data-ol-out="plan">Básico</output></div>');
    const b = doc('<div data-ol-calc><select data-ol-val="plan"><option value="basico">Básico</option><option value="pro" selected>Pro</option></select><output data-ol-out="plan">Básico</output></div>');
    expect(behaviorContractFingerprint(a)).not.toBe(behaviorContractFingerprint(b));
  });

  it("detecta required/untrusted: cambiar href cambia lo que abre lightbox", () => {
    const a = doc('<a data-ol-lightbox href="https://images.openlen.com/a.jpg"><img src="a.jpg"></a>');
    const b = doc('<a data-ol-lightbox href="https://images.openlen.com/b.jpg"><img src="a.jpg"></a>');
    expect(behaviorContractFingerprint(a)).not.toBe(behaviorContractFingerprint(b));
  });

  it("detecta configuración descendiente que lightbox consume para el modal", () => {
    const a = doc('<a data-ol-lightbox href="https://images.openlen.com/a.jpg"><img src="a.jpg" alt="Pastel de boda"></a>');
    const b = doc('<a data-ol-lightbox href="https://images.openlen.com/a.jpg"><img src="a.jpg" alt="Pastel de cumpleaños"></a>');
    expect(behaviorContractFingerprint(a)).not.toBe(behaviorContractFingerprint(b));
  });

  it("detecta wiring de filter: grupo/target y tags", () => {
    const a = doc('<div data-ol-filter-group="menu"><button data-ol-filter="tacos">Tacos</button></div><div data-ol-filter-target="menu"><article data-ol-tag="tacos">A</article></div>');
    const b = doc('<div data-ol-filter-group="galeria"><button data-ol-filter="tacos">Tacos</button></div><div data-ol-filter-target="galeria"><article data-ol-tag="bebidas">A</article></div>');
    expect(behaviorContractFingerprint(a)).not.toBe(behaviorContractFingerprint(b));
  });

  it("detecta wiring de tabs: grupo, contenedor y panel", () => {
    const a = doc('<div data-ol-tabs="planes"><button data-ol-tab="mensual">Mes</button></div><div data-ol-tab-panels="planes"><section data-ol-tab-panel="mensual">A</section></div>');
    const b = doc('<div data-ol-tabs="precios"><button data-ol-tab="mensual">Mes</button></div><div data-ol-tab-panels="precios"><section data-ol-tab-panel="anual">A</section></div>');
    expect(behaviorContractFingerprint(a)).not.toBe(behaviorContractFingerprint(b));
  });

  it("detecta el valor de una parte consumida por countdown", () => {
    const a = doc('<div data-ol-countdown="2030-01-01T00:00:00Z"><span data-ol-cd="days">00</span></div>');
    const b = doc('<div data-ol-countdown="2030-01-01T00:00:00Z"><span data-ol-cd="hours">00</span></div>');
    expect(behaviorContractFingerprint(a)).not.toBe(behaviorContractFingerprint(b));
  });

  it("normaliza valores irrelevantes de marcadores flag y piezas sólo estructurales", () => {
    const a = doc('<button data-ol-theme></button><div data-ol-row><i data-ol-autoplay="5000"></i><div data-ol-scroller></div></div>');
    const b = doc('<button data-ol-theme="adorno"></button><div data-ol-row="adorno"><i data-ol-autoplay="5000"></i><div data-ol-scroller="adorno"></div></div>');
    expect(behaviorContractFingerprint(a)).toBe(behaviorContractFingerprint(b));
  });

  it("ignora copy, data-op-id y orden de atributos", () => {
    const a = doc('<code id="a">A20</code><button data-op-id="1" class="x" data-ol-copy="a">Copiar A</button><code id="b">B30</code><button data-ol-copy="b" class="y" data-op-id="2">Copiar B</button>');
    const b = doc('<code id="a">Texto A nuevo</code><button class="distinta" data-ol-copy="a" data-op-id="88">Obtén A</button><code id="b">Texto B nuevo</code><button data-op-id="99" data-ol-copy="b" class="otra">Obtén B</button>');
    expect(behaviorContractFingerprint(a)).toBe(behaviorContractFingerprint(b));
  });

  it("preserva identidad: intercambiar los targets de dos controles copy cambia la huella", () => {
    const a = doc('<code id="a">A</code><code id="b">B</code><button id="ba" data-ol-copy="a">A</button><button id="bb" data-ol-copy="b">B</button>');
    const b = doc('<code id="a">A</code><code id="b">B</code><button id="ba" data-ol-copy="b">A</button><button id="bb" data-ol-copy="a">B</button>');
    expect(behaviorContractFingerprint(a)).not.toBe(behaviorContractFingerprint(b));
  });

  it("preserva asociación del swap copy aun sin ids en los controles", () => {
    const a = doc('<code id="a">A</code><code id="b">B</code><section><button data-ol-copy="a">A</button></section><aside><button data-ol-copy="b">B</button></aside>');
    const b = doc('<code id="a">A</code><code id="b">B</code><section><button data-ol-copy="b">A</button></section><aside><button data-ol-copy="a">B</button></aside>');
    expect(behaviorContractFingerprint(a)).not.toBe(behaviorContractFingerprint(b));
  });

  it("modela multiple y el value efectivo inicial de un select calc", () => {
    const a = doc('<div data-ol-calc><select data-ol-val="plan"><option value="basico" selected>Básico</option><option value="pro">Pro</option></select><output data-ol-out="plan">Básico</output></div>');
    const b = doc('<div data-ol-calc><select data-ol-val="plan" multiple><option value="basico" selected>Básico</option><option value="pro">Pro</option></select><output data-ol-out="plan">Básico</output></div>');
    expect(behaviorContractFingerprint(a)).not.toBe(behaviorContractFingerprint(b));
  });

  it("ignora el texto de option cuando value explícito gobierna el runtime", () => {
    const a = doc('<div data-ol-calc><select data-ol-val="plan"><option value="pro" selected>Plan Pro</option></select><output data-ol-out="plan">pro</output></div>');
    const b = doc('<div data-ol-calc><select data-ol-val="plan"><option value="pro" selected>Profesional</option></select><output data-ol-out="plan">pro</output></div>');
    expect(behaviorContractFingerprint(a)).toBe(behaviorContractFingerprint(b));
  });

  it("detecta cuando option directa y optgroup permutan el value efectivo del select", () => {
    const controlA = '<select data-ol-val="plan"><option value="direct">Directo</option><optgroup label="Grupo"><option value="group">Grupo</option></optgroup></select>';
    const controlB = '<select data-ol-val="plan"><optgroup label="Grupo"><option value="group">Grupo</option></optgroup><option value="direct">Directo</option></select>';
    const a = doc(`<div data-ol-calc>${controlA}<output data-ol-out="plan">x</output></div>`);
    const b = doc(`<div data-ol-calc>${controlB}<output data-ol-out="plan">x</output></div>`);

    expect((browserElement(controlA, "select") as HTMLSelectElement).value).toBe("direct");
    expect((browserElement(controlB, "select") as HTMLSelectElement).value).toBe("group");
    expect(behaviorContractFingerprint(a)).not.toBe(behaviorContractFingerprint(b));
  });

  it("detecta cuando optgroup disabled cambia el value efectivo heredado del select", () => {
    const controlA = '<select data-ol-val="plan"><optgroup label="Grupo"><option value="group">Grupo</option></optgroup><option value="direct">Directo</option></select>';
    const controlB = '<select data-ol-val="plan"><optgroup label="Grupo" disabled><option value="group">Grupo</option></optgroup><option value="direct">Directo</option></select>';
    const a = doc(`<div data-ol-calc>${controlA}<output data-ol-out="plan">x</output></div>`);
    const b = doc(`<div data-ol-calc>${controlB}<output data-ol-out="plan">x</output></div>`);

    expect((browserElement(controlA, "select") as HTMLSelectElement).value).toBe("group");
    expect((browserElement(controlB, "select") as HTMLSelectElement).value).toBe("direct");
    expect(behaviorContractFingerprint(a)).not.toBe(behaviorContractFingerprint(b));
  });

  it("preserva asociación: intercambiar fórmulas entre dos outputs cambia la huella", () => {
    const a = doc('<div data-ol-calc><input data-ol-val="precio" value="10"><output id="doble" data-ol-out="precio * 2">20</output><output id="triple" data-ol-out="precio * 3">30</output></div>');
    const b = doc('<div data-ol-calc><input data-ol-val="precio" value="10"><output id="doble" data-ol-out="precio * 3">20</output><output id="triple" data-ol-out="precio * 2">30</output></div>');
    expect(behaviorContractFingerprint(a)).not.toBe(behaviorContractFingerprint(b));
  });

  it("detecta qué sticky cablea querySelector al permutar nav y header", () => {
    const bodyA = '<nav data-ol-sticky data-probe="nav"></nav><header data-ol-sticky data-probe="header"></header><style>[data-ol-stuck]{color:red}</style>';
    const bodyB = '<header data-ol-sticky data-probe="header"></header><nav data-ol-sticky data-probe="nav"></nav><style>[data-ol-stuck]{color:red}</style>';

    expect(browserElement(bodyA, "[data-ol-sticky]").getAttribute("data-probe")).toBe("nav");
    expect(browserElement(bodyB, "[data-ol-sticky]").getAttribute("data-probe")).toBe("header");
    expect(behaviorContractFingerprint(doc(bodyA))).not.toBe(behaviorContractFingerprint(doc(bodyB)));
  });

  it("detecta qué target filter resuelve primero al permutar tags distintos", () => {
    const group = '<div data-ol-filter-group="g"><button data-ol-filter="*">Todo</button></div>';
    const divTarget = '<div data-ol-filter-target="g"><article data-ol-tag="div">Div</article></div>';
    const sectionTarget = '<section data-ol-filter-target="g"><article data-ol-tag="section">Section</article></section>';
    const bodyA = group + divTarget + sectionTarget;
    const bodyB = group + sectionTarget + divTarget;
    const selectedTag = (body: string) =>
      browserElement(body, '[data-ol-filter-target="g"] [data-ol-tag]').getAttribute("data-ol-tag");

    expect(selectedTag(bodyA)).toBe("div");
    expect(selectedTag(bodyB)).toBe("section");
    expect(behaviorContractFingerprint(doc(bodyA))).not.toBe(behaviorContractFingerprint(doc(bodyB)));
  });

  it("detecta qué target tabs resuelve primero al permutar tags distintos", () => {
    const group = '<div data-ol-tabs="g"><button data-ol-tab="one">Uno</button></div>';
    const divTarget = '<div data-ol-tab-panels="g"><article data-ol-tab-panel="one">Div</article></div>';
    const sectionTarget = '<section data-ol-tab-panels="g"><article data-ol-tab-panel="two">Section</article></section>';
    const bodyA = group + divTarget + sectionTarget;
    const bodyB = group + sectionTarget + divTarget;
    const selectedPanel = (body: string) =>
      browserElement(body, '[data-ol-tab-panels="g"] [data-ol-tab-panel]').getAttribute("data-ol-tab-panel");

    expect(selectedPanel(bodyA)).toBe("one");
    expect(selectedPanel(bodyB)).toBe("two");
    expect(behaviorContractFingerprint(doc(bodyA))).not.toBe(behaviorContractFingerprint(doc(bodyB)));
  });

  it("mantiene acotada la salida con 500 filtros y 500 items compartidos", () => {
    const buttons = Array.from({ length: 500 }, (_, i) => `<button data-ol-filter="t${i}">T${i}</button>`).join("");
    const items = Array.from({ length: 500 }, (_, i) => `<article data-ol-tag="t${i}">I${i}</article>`).join("");
    const html = doc(`<div data-ol-filter-group="g">${buttons}</div><div data-ol-filter-target="g">${items}</div>`);
    const stats = behaviorContractProjectionStats(html);
    expect(stats).toEqual(expect.objectContaining({ elementCount: 1002, relationCount: 1 }));
    expect(stats.bytes).toBeLessThan(250_000);
    expect(behaviorContractFingerprint(html)).toHaveLength(64);
  });

  // Un techo absoluto no distingue «lineal y grande» de «cuadrático y aún
  // pequeño». Esto sí: doblar el documento debe doblar la proyección. El
  // multiconjunto anterior la cuadruplicaba — 0,78 MB con 100+100 y 19,3 MB
  // con 500+500 — y `tocaConducta` calcula DOS huellas por edición.
  it("la proyección crece LINEAL con el documento, no al cuadrado", () => {
    const escena = (n: number) => {
      const bs = Array.from({ length: n }, (_, i) => `<button data-ol-filter="t${i}">T${i}</button>`).join("");
      const is = Array.from({ length: n }, (_, i) => `<article data-ol-tag="t${i}">I${i}</article>`).join("");
      return doc(`<div data-ol-filter-group="g">${bs}</div><div data-ol-filter-target="g">${is}</div>`);
    };
    const chico = behaviorContractProjectionStats(escena(250));
    const grande = behaviorContractProjectionStats(escena(500));
    expect(chico.elementCount).toBe(502);
    expect(grande.elementCount).toBe(1002);
    expect(grande.bytes / chico.bytes).toBeLessThan(2.4);
  });

  it("mantiene compacta la identidad en targets profundamente anidados", () => {
    const escena = (n: number) => {
      const opens = Array.from({ length: n }, (_, i) => `<div data-ol-tag="t${i}">`).join("");
      const closes = "</div>".repeat(n);
      return doc('<div data-ol-filter-group="g"><button data-ol-filter="*">Todo</button></div>' +
        `<section data-ol-filter-target="g">${opens}hoja${closes}</section>`);
    };
    const chico = behaviorContractProjectionStats(escena(250));
    const grande = behaviorContractProjectionStats(escena(500));

    expect(chico).toEqual(expect.objectContaining({ elementCount: 253, relationCount: 1 }));
    expect(grande).toEqual(expect.objectContaining({ elementCount: 503, relationCount: 1 }));
    expect(grande.bytes).toBeLessThan(150_000);
    expect(grande.bytes / chico.bytes).toBeLessThan(2.5);
  });

  // EL PRECIO de la identidad estructural, declarado y sujeto por una prueba
  // para que nadie lo «arregle» de vuelta. Cruzar la configuración de dos
  // hermanos y reordenar esos dos hermanos producen EXACTAMENTE el mismo
  // árbol; uno cambia la conducta y el otro no, y son indistinguibles. Se
  // avisa de los dos: pedir una prueba que sobraba cuesta un turno, callarse
  // publica una conducta que nadie miró.
  it("avisa también de una reordenación pura, porque no se distingue de un cruce", () => {
    const a = doc('<code id="a">A</code><code id="b">B</code><button data-ol-copy="a">A</button><button data-ol-copy="b">B</button>');
    const b = doc('<code id="a">A</code><code id="b">B</code><button data-ol-copy="b">B</button><button data-ol-copy="a">A</button>');
    expect(behaviorContractFingerprint(a)).not.toBe(behaviorContractFingerprint(b));
  });

  // El ancla de un idRef no lleva marcador: sin proyectarla, renombrarla
  // rompía `copy` en silencio y la huella no se enteraba.
  it("detecta que el ancla de un copy desapareció bajo otro id", () => {
    const a = doc('<code id="a">A20</code><button data-ol-copy="a">Copiar</button>');
    const b = doc('<code id="z">A20</code><button data-ol-copy="a">Copiar</button>');
    expect(behaviorContractFingerprint(a)).not.toBe(behaviorContractFingerprint(b));
  });

  // CONTRA-PRUEBA del anterior: se proyecta que el ancla EXISTE y dónde, no
  // lo que dice. Un cupón que cambia de valor sigue siendo el mismo contrato.
  it("pero no del texto del ancla: un cupón que cambia de valor es el mismo contrato", () => {
    const a = doc('<code id="a">A20</code><button data-ol-copy="a">Copiar</button>');
    const b = doc('<code id="a">B30</code><button data-ol-copy="a">Copiar</button>');
    expect(behaviorContractFingerprint(a)).toBe(behaviorContractFingerprint(b));
  });

  // CONTRA-PRUEBA de la identidad estructural: el camino la lleva, no el id.
  // Renombrar un id decorativo no es un cambio de conducta y no debe costar
  // una prueba — el ancla de un idRef es harina de otro costal, arriba.
  it("no se inmuta si el modelo renombra un id que ninguna conducta lee", () => {
    const a = doc('<code id="a">A</code><button id="ba" data-ol-copy="a">Copiar</button>');
    const b = doc('<code id="a">A</code><button id="boton-copiar" data-ol-copy="a">Copiar</button>');
    expect(behaviorContractFingerprint(a)).toBe(behaviorContractFingerprint(b));
  });

  // ── Lo que encontró la revisión independiente del 25/08 ──────────────────

  // EL MISMO CRUCE, UNA CASILLA MÁS ALLÁ. Los botones no se tocan: se
  // intercambian los ids de las dos ANCLAS. #ba pasa a copiar el cupón de #bb
  // y al revés. Con el rol del ancla pelado, las dos filas salían byte a byte
  // idénticas y el cruce se cancelaba solo — multiconjunto otra vez, dentro de
  // la proyección. Hace falta que haya DOS botones: con uno, el camino del
  // ancla se mueve y ya se veía.
  it("intercambiar los ids de las dos anclas de copy cambia la huella", () => {
    const a = doc('<code id="a">CUPON-A</code><code id="b">CUPON-B</code><button data-ol-copy="a">A</button><button data-ol-copy="b">B</button>');
    const b = doc('<code id="b">CUPON-A</code><code id="a">CUPON-B</code><button data-ol-copy="a">A</button><button data-ol-copy="b">B</button>');
    expect(behaviorContractFingerprint(a)).not.toBe(behaviorContractFingerprint(b));
  });

  // El navegador no entrega la PRIMERA opción, entrega la primera SELECCIONABLE.
  // Medido en Chrome: con la primera `disabled`, `select.value` es la segunda.
  // calc lee `e.value`, así que esto cambia el valor inicial del cálculo entero.
  it("deshabilitar la primera opción cambia el value que calc recibe", () => {
    const a = doc('<div data-ol-calc><select data-ol-val="plan"><option value="free">Gratis</option><option value="pro">Pro</option></select><output data-ol-out="plan">x</output></div>');
    const b = doc('<div data-ol-calc><select data-ol-val="plan"><option value="free" disabled>Gratis</option><option value="pro">Pro</option></select><output data-ol-out="plan">x</output></div>');
    expect(behaviorContractFingerprint(a)).not.toBe(behaviorContractFingerprint(b));
  });

  // Un `range` no lleva su valor en un atributo: sin `value`, el navegador
  // entrega el punto medio de min/max. Medido en Chrome: max=100 da "50",
  // max=1000 da "500". Retocar el recorrido cambia el resultado inicial.
  it("cambiar el recorrido de un deslizador cambia la huella", () => {
    const a = doc('<div data-ol-calc><input data-ol-val="n" type="range" min="0" max="100"><output data-ol-out="n">x</output></div>');
    const b = doc('<div data-ol-calc><input data-ol-val="n" type="range" min="0" max="1000"><output data-ol-out="n">x</output></div>');
    expect(behaviorContractFingerprint(a)).not.toBe(behaviorContractFingerprint(b));
  });

  // CONTRA-PRUEBA del anterior: en un `number` el valor SÍ está en el atributo,
  // así que min/max acotan pero no cambian lo que el runtime lee al arrancar.
  // Sin esto, «captura min y max» se convertiría en «captura todo por si acaso».
  it("pero no en un number, donde min/max no deciden el valor inicial", () => {
    const a = doc('<div data-ol-calc><input data-ol-val="n" type="number" value="3" min="0" max="100"><output data-ol-out="n">x</output></div>');
    const b = doc('<div data-ol-calc><input data-ol-val="n" type="number" value="3" min="0" max="1000"><output data-ol-out="n">x</output></div>');
    expect(behaviorContractFingerprint(a)).toBe(behaviorContractFingerprint(b));
  });

  // EL COSTE, en la forma que el fixture de arriba no tiene. `requiresHost` es
  // ancestor-OR-SELF y el runtime usa closest(), así que un botón puede llevar
  // él mismo el atributo de grupo. Con la relación anclada en QUIÉN la hospeda,
  // 500 botones daban 500 relaciones y 500 recorridos de los MISMOS objetivos:
  // medido, 47 → 162 → 558 ms al doblar. Anclada en el VALOR, un recorrido.
  it("no se dispara cuando cada control lleva su propio atributo de grupo", () => {
    const escena = (n: number) => {
      const bs = Array.from({ length: n }, (_, i) => `<button data-ol-filter-group="g" data-ol-filter="t${i}">T${i}</button>`).join("");
      const is = Array.from({ length: n }, (_, i) => `<article data-ol-tag="t${i}">I${i}</article>`).join("");
      return doc(`<div>${bs}</div><div data-ol-filter-target="g">${is}</div>`);
    };
    const chico = behaviorContractProjectionStats(escena(250));
    const grande = behaviorContractProjectionStats(escena(500));
    expect(chico.relationCount).toBe(1);
    expect(grande.relationCount).toBe(1);
    expect(grande.bytes / chico.bytes).toBeLessThan(2.4);
  });
});

// Dos crossRefs de la MISMA receta que comparten `via` y `target` y traen
// partes distintas. Ninguna receta de hoy tiene dos, pero el contrato de este
// archivo es que añadir la conducta #20 no lo toque — y sin el índice en la
// clave, la segunda relación se perdía ENTERA y sus partes no se proyectaban.
const REG_DOS_CROSSREFS = {
  filter: {
    name: "filter", marker: "data-ol-filter", js: "", budgetBytes: 700,
    schema: {
      root: { kind: "tagList" },
      crossRefs: [
        { via: "data-ol-filter-group", target: "data-ol-filter-target", why: "",
          targetParts: [{ selector: "[data-ol-tag]", attrs: ["data-ol-tag"] }] },
        { via: "data-ol-filter-group", target: "data-ol-filter-target", why: "",
          targetParts: [{ selector: "[data-ol-orden]", attrs: ["data-ol-orden"] }] },
      ],
    },
    degradation: "control-inert", a11y: [], status: "stable",
    doc: { when: "", whenNot: "", example: "" },
  },
} as unknown as Partial<Record<BehaviorName, Behavior>>;

describe("dos crossRefs que comparten via y target", () => {
  const html = (orden: string) =>
    doc(`<div data-ol-filter-group="g"><button data-ol-filter="t">T</button></div><div data-ol-filter-target="g"><article data-ol-tag="t" data-ol-orden="${orden}">A</article></div>`);

  it("la SEGUNDA también se proyecta", () => {
    expect(behaviorContractFingerprint(html("1"), REG_DOS_CROSSREFS))
      .not.toBe(behaviorContractFingerprint(html("2"), REG_DOS_CROSSREFS));
  });
});

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

// Hallazgo del eval conducta-theme (2026-07-14, corrida real): Gemini puso
// data-ol-theme SIN ningún CSS que reaccionara a .dark — la advertencia en
// prosa no bastó, y el propio código admitía "el validador no tiene
// vocabulario para esto; el eval es la ÚNICA red". requiresCss ES ese
// vocabulario: la garantía deja de depender de que el modelo obedezca al
// prompt y pasa a ser mecánica (canal aviso → se arregla en el mismo turno).
const THEME_CSS_REG = {
  theme: {
    name: "theme", marker: "data-ol-theme", js: "", budgetBytes: 700,
    schema: {
      root: { kind: "flag" },
      requiresCss: {
        pattern: "\\.dark\\b|:root\\.dark|(?:^|[\\s\"'`])dark:",
        why: "el botón conmuta la clase dark pero ningún CSS la escucha — define :root.dark{…} con valores realmente distintos",
      },
    },
    degradation: "control-inert", a11y: [], status: "stable",
    doc: { when: "", whenNot: "", example: "" },
  },
} as unknown as Partial<Record<BehaviorName, Behavior>>;

describe("validateBehaviors — requiresCss (el documento debe traer CSS que escuche al marcador)", () => {
  it("caza un data-ol-theme sin NINGÚN CSS que reaccione a .dark — nacería muerto", () => {
    const html = doc(`<button data-ol-theme>Tema</button>`);
    const issues = validateBehaviors(html, THEME_CSS_REG);
    expect(issues).toHaveLength(1);
    expect(issues[0].behavior).toBe("theme");
    expect(issues[0].message).toMatch(/dark/);
  });
  it("acepta el flip :root.dark en un <style>", () => {
    const html = doc(`<style>:root.dark{--bg:#0f1115}</style><button data-ol-theme>Tema</button>`);
    expect(validateBehaviors(html, THEME_CSS_REG)).toEqual([]);
  });
  it("acepta variantes dark: de Tailwind", () => {
    const html = doc(`<body class="bg-white dark:bg-zinc-950"><button data-ol-theme>Tema</button></body>`);
    expect(validateBehaviors(html, THEME_CSS_REG)).toEqual([]);
  });
  it("página SIN el marcador: cero issues (la regla solo aplica si la conducta se usa)", () => {
    const html = doc(`<h1>Sin theme</h1>`);
    expect(validateBehaviors(html, THEME_CSS_REG)).toEqual([]);
  });
  it("dos botones de theme sin CSS: UN issue, no dos (dedupe por receta)", () => {
    const html = doc(`<button data-ol-theme>A</button><button data-ol-theme>B</button>`);
    expect(validateBehaviors(html, THEME_CSS_REG)).toHaveLength(1);
  });
});
