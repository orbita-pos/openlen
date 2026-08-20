import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Behavior, BehaviorName } from "./types";

// Arreglo 1 (revisión final de rama, feat/conductas) — la tesis de toda esta
// arquitectura es "de una sola declaración se derivan el runtime, el
// validador, los docs y los tests — así no pueden divergir". Eso YA era
// cierto para el catálogo GENERADO por receta (ver doc.test.ts: una receta
// nueva en BEHAVIOR_ORDER entra sola en la salida de buildBehaviorsDoc()).
// Pero TRES frases sueltas en prosa por fuera de ese catálogo generado (más
// una 4ª en agent/tools.ts, cubierta aparte — ver abajo) seguían escribiendo
// la lista y el NÚMERO a mano — dos de ellas literalmente "siete" —
// precisamente la imagen especular del bug fundacional de este proyecto
// (DESIGN_GUIDANCE prometía un <script> que el sanitizer llevaba meses
// borrando, porque la verdad vivía en dos sitios).
//
// Este test prueba la propiedad DERIVADA, no el texto de hoy: mockea
// BEHAVIOR_ORDER/BEHAVIORS con una 8ª receta FALSA en memoria y reimporta los
// 3 sitios que se pueden cargar bajo vitest (design-guidance.ts,
// agent/catalog.ts, y este mismo generador — doc.ts) SIN TOCAR ningún archivo
// de prosa. El 4º sitio (agent/tools.ts's sanitizeAviso) necesita el binding
// nativo de html-engine que vitest/jsdom no puede cargar (ver el NB de
// lib/agent en vitest.config.ts) — se prueba aparte, bajo node:test, con
// inyección de parámetro: ver lib/agent/tools.test.ts, "Arreglo 1".
//
// GOTCHA REAL cazado escribiendo este test (no solo de estilo): los 3 sitios
// se EMBEBEN unos en otros (catalog.ts's buildAgentSystemPrompt() incluye
// DESIGN_GUIDANCE entero, que a su vez incluye buildBehaviorsDoc() entero).
// Una primera versión de este test solo comprobaba "¿el texto de cada sitio
// contiene la lista derivada en ALGUNA parte?" — y eso pasaba en VERDE
// incluso con design-guidance.ts revertido a mano a "seven / countdown,
// filter, ...", porque la lista SÍ aparecía de todos modos vía el
// buildBehaviorsDoc() embebido. Cada aserción de abajo usa una frase ÚNICA de
// SU sitio (nunca la de otro) para que revertir un solo sitio ponga rojo SOLO
// ese assert, no los otros dos por contagio de la cadena de embeds.
describe("Arreglo 1 — los sitios en prosa DERIVAN de BEHAVIOR_ORDER, no lo copian a mano", () => {
  const FAKE_NAME = "confetti" as BehaviorName;
  const FAKE_MARKER = "data-ol-confetti";

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("./registry");
    vi.resetModules();
  });

  it("una 8ª receta falsa en el registro aparece en design-guidance.ts, agent/catalog.ts y la cabecera de buildBehaviorsDoc(), sin editar ningún archivo de prosa", async () => {
    vi.doMock("./registry", async () => {
      const real = await vi.importActual<{
        BEHAVIORS: Record<BehaviorName, Behavior>;
        BEHAVIOR_ORDER: BehaviorName[];
      }>("./registry");
      const fake: Behavior = {
        name: FAKE_NAME,
        marker: FAKE_MARKER,
        schema: { root: { kind: "flag" } },
        js: "",
        budgetBytes: 700,
        docBudgetChars: 1200,
        degradation: "content-intact",
        a11y: [],
        doc: {
          label: "efecto de confeti",
          when: "cuando quieras celebrar algo en la página — un lanzamiento, una meta cumplida.",
          whenNot: "nunca en una página de negocio serio (una notaría, un despacho legal).",
          example: `<div ${FAKE_MARKER}></div>`,
        },
        status: "stable",
      };
      // Spread del registro REAL (8 recetas de verdad, tabs incluida) + una
      // FALSA extra — nunca un registro inventado desde cero, para que la
      // prueba sea sobre "una más" y no sobre un catálogo distinto.
      return {
        BEHAVIORS: { ...real.BEHAVIORS, [FAKE_NAME]: fake },
        BEHAVIOR_ORDER: [...real.BEHAVIOR_ORDER, FAKE_NAME],
      };
    });

    // Import dinámico DESPUÉS del mock — doc.ts, design-guidance.ts y
    // catalog.ts todos importan (transitivamente) "./registry" con el mismo
    // specifier resuelto (lib/behaviors/registry.ts), así que los tres ven
    // el registro mockeado una vez reimportados frescos.
    const {
      BEHAVIOR_NAMES: fakeNames,
      BEHAVIOR_COUNT: fakeCount,
      BEHAVIOR_LABELS: fakeLabels,
      buildBehaviorsDoc,
    } = await import("./doc");
    const { DESIGN_GUIDANCE } = await import("../design-guidance");
    const { buildAgentSystemPrompt } = await import("../agent/catalog");

    // Derivado, NO cableado: un `toBe(9)` a mano se pone rojo cada vez que se
    // registra una receta, y el rojo no dice nada sobre la propiedad que esta
    // prueba defiende — sólo que el catálogo creció. Lo que de verdad se
    // afirma es "el registro mockeado tiene UNA receta más que el real".
    const realOrder = (
      await vi.importActual<{ BEHAVIOR_ORDER: BehaviorName[] }>("./registry")
    ).BEHAVIOR_ORDER;
    expect(fakeCount, "el registro mockeado debe tener una receta más que el real").toBe(
      realOrder.length + 1,
    );
    expect(fakeNames).toContain(FAKE_NAME);
    expect(fakeLabels).toContain("efecto de confeti");

    // Sitio 1 — lib/behaviors/doc.ts, la cabecera del propio generador.
    // Frase ÚNICA de este sitio: "solo (glosas en español)" — deriva de
    // doc.label de cada receta, NUNCA de BEHAVIOR_NAMES (los nombres de
    // MÁQUINA que usan design-guidance.ts/catalog.ts en sus propias frases,
    // comprobadas más abajo). Arreglo 3 (revisión final de rama): esta
    // cabecera decía las glosas en español ANTES de que la derivación de
    // BEHAVIOR_NAMES/BEHAVIOR_COUNT (arriba) la hiciera decir los nombres de
    // máquina en su lugar — perdiendo el puente semántico que un modelo en
    // español necesita para mapear "quiero un contador" a `countdown`.
    // doc.label lo recupera, derivado: una 8ª receta aporta la suya sola.
    expect(
      buildBehaviorsDoc(),
      "doc.ts: la cabecera de buildBehaviorsDoc() no deriva la glosa en español (doc.label) de la receta nueva",
    ).toContain(`solo (${fakeLabels})`);

    // Sitio 2 — lib/design-guidance.ts. Frase ÚNICA de este sitio (inglés,
    // "for the N things CSS genuinely cannot do" — ni doc.ts ni catalog.ts
    // usan esta redacción). Se comprueba en DOS pedazos porque el template
    // real tiene un salto de línea entre "do" y "alone" — comprobarlos por
    // separado no depende de la indentación exacta.
    expect(
      DESIGN_GUIDANCE,
      "design-guidance.ts: no deriva el número de conductas en su propia frase",
    ).toContain(`for the ${fakeCount} things CSS genuinely cannot do`);
    expect(
      DESIGN_GUIDANCE,
      "design-guidance.ts: no deriva la lista de conductas en su propia frase",
    ).toContain(`alone — ${fakeNames}.`);

    // Sitio 3 — lib/agent/catalog.ts. Frase ÚNICA de este sitio ("para las N
    // cosas que el CSS no puede solo (nombres)" — el número va ANTES, sin
    // dos-puntos dentro del paréntesis, a diferencia del formato de doc.ts).
    expect(
      buildAgentSystemPrompt(),
      "catalog.ts: no deriva el número+lista en su propia frase",
    ).toContain(`para las ${fakeCount} cosas que el CSS no puede solo (${fakeNames})`);

    // Cinturón y tirantes: el marcador de la receta falsa también debe
    // colarse en los 3 (vía la entrada generada de buildBehaviorsDoc(), que
    // SÍ ya derivaba correctamente antes de este Arreglo — doc.test.ts lo
    // cubre a fondo). Confirma que ninguno de los 3 sitios trunca o filtra
    // el catálogo antes de mostrarlo.
    for (const [siteName, text] of [
      ["doc.ts", buildBehaviorsDoc()],
      ["design-guidance.ts", DESIGN_GUIDANCE],
      ["catalog.ts", buildAgentSystemPrompt()],
    ] as const) {
      expect(text, `${siteName}: falta el marcador de la 8ª receta falsa`).toContain(FAKE_MARKER);
    }
  });
});
