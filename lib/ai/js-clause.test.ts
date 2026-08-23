import { describe, expect, it } from "vitest";

import { swapJsClauses, clauseMarker } from "./js-clause";
import { SYSTEM_PROMPT, systemPromptFor } from "../../app/api/generate/system-prompt";
import { modelRuntimePromptBlock } from "../ai-stream/model-runtime";
import { SYSTEM_PROMPT as CHAT_SYSTEM_PROMPT } from "../../app/api/templates/ai-design/system-prompt";
import { buildRedesignPrompt } from "../agent/redesign";

const OFF = {} as const;
const ON = { OPENLEN_MODEL_JS: "1" } as const;
const ON_MIN = { OPENLEN_MODEL_JS: "1", OPENLEN_MIN_CONTRACT: "1" } as const;
// El contrato MÍNIMO pasó a ser el DEFECTO el 2026-08-23. Para probar el
// completo hay que pedirlo: sin esto media suite mediría el prompt equivocado y
// pasaría por el motivo que no es.
const COMPLETO = { OPENLEN_MIN_CONTRACT: "0" } as const;
const ON_COMPLETO = { OPENLEN_MODEL_JS: "1", OPENLEN_MIN_CONTRACT: "0" } as const;

describe("el interruptor apagado no cuesta nada", () => {
  it("devuelve el prompt intacto", () => {
    expect(swapJsClauses(SYSTEM_PROMPT, ["contrato-completo", "no-negociable"], OFF)).toBe(SYSTEM_PROMPT);
  });

  it("y el prompt COMPLETO de crear sigue siendo el de siempre", () => {
    expect(systemPromptFor(COMPLETO)).toBe(SYSTEM_PROMPT);
  });

  it("con el interruptor apagado las CONDUCTAS siguen enteras — son la única interactividad que hay", () => {
    const apagado = systemPromptFor(COMPLETO);
    expect(apagado).toContain("data-ol-sticky");
    expect(apagado).toContain("• CAROUSEL");
  });
});

/**
 * EL SEGUNDO FALLO DE LA MISMA FAMILIA, medido el 2026-08-23 sobre una página
 * REAL generada por Jesús.
 *
 * `contrato-completo` ya se llevaba la ORDEN de usar conductas («2. A CONDUCTA,
 * for the 9 things CSS genuinely cannot do»), pero dejaba en pie los 10.752
 * caracteres del MANUAL: el contrato del carrusel más `buildBehaviorsDoc()`. Con
 * el JavaScript libre YA encendido, el modelo leyó el manual y emitió
 * `data-ol-sticky` — y olvidó la regla CSS de `[data-ol-stuck]`, así que el nav
 * nacía mudo y la página avisó de una degradación.
 *
 * Quitar la orden y dejar el manual delante es no quitar nada.
 */
describe("con JS libre, las conductas desaparecen del prompt", () => {
  it("ni un solo marcador declarativo sobrevive", () => {
    const vivo = systemPromptFor(ON_COMPLETO);
    for (const marcador of [
      "data-ol-sticky",
      "data-ol-filter",
      "data-ol-lightbox",
      "data-ol-countdown",
      "data-ol-scroller",
      "CONDUCTAS",
    ]) {
      expect(vivo, `el prompt todavía enseña ${marcador}`).not.toContain(marcador);
    }
  });

  it("y en su lugar se le dice que la escriba él, con las dos mitades", () => {
    const vivo = systemPromptFor(ON_COMPLETO);
    expect(vivo).toContain("INTERACTIVIDAD — la escribes TÚ");
    // La lección del nav mudo, generalizada: comportamiento Y su CSS.
    expect(vivo).toContain("LAS DOS MITADES");
  });

  it("el Chat recibe exactamente el mismo trato", () => {
    const vivo = swapJsClauses(CHAT_SYSTEM_PROMPT, ["contrato-completo", "conductas", "no-negociable"], ON);
    expect(vivo).not.toContain("data-ol-sticky");
    expect(vivo).toContain("INTERACTIVIDAD — la escribes TÚ");
  });

  // El rediseño interpola DESIGN_GUIDANCE entera, así que arrastraba el mismo
  // manual. Las TRES superficies o ninguna: si una sigue enseñando conductas,
  // el usuario ve una página con marcadores y otra sin ellos según qué botón
  // pulsó, que es peor que no haber tocado nada.
  it("el rediseño del Agente también", () => {
    const crudo = buildRedesignPrompt({ direccion: "más oscuro", html: "<p>x</p>" } as never);
    expect(crudo, "sanity: el rediseño trae el manual").toContain("data-ol-sticky");
    const vivo = swapJsClauses(crudo, ["rediseno", "conductas"], ON);
    expect(vivo).not.toContain("data-ol-sticky");
    expect(vivo).toContain("INTERACTIVIDAD — la escribes TÚ");
  });

  // El contrato mínimo ya había sustituido `PUBLISH_CONTRACT` entero, y con él
  // se fueron carrusel y conductas. Pedir la marca ahí haría LANZAR.
  it("el contrato mínimo no pide la cláusula — no la tiene y lanzaría", () => {
    expect(() => systemPromptFor(ON_MIN)).not.toThrow();
    expect(systemPromptFor(ON_MIN)).not.toContain("data-ol-sticky");
  });

  // LA FORMA DE PRODUCCIÓN desde el 2026-08-23: mínimo por defecto + JS libre.
  // Los dos interruptores están pensados para ir juntos — el mínimo a solas
  // entrega páginas inertes, medido 0/6 (ver `system-prompt.ts`).
  it("el prompt que de verdad se envía: mínimo, con JS libre y sin conductas", () => {
    const real = systemPromptFor(ON);
    expect(real).not.toContain("data-ol-sticky");
    expect(real).not.toContain("CONDUCTAS");
    // La prohibición del mínimo está VOLTEADA, no simplemente ausente.
    expect(real).not.toContain(clauseMarker("contrato-min"));
    expect(real).toContain("<script data-openlen-model-runtime>");
    expect(real.length).toBeLessThan(systemPromptFor(ON_COMPLETO).length);
  });
});

/**
 * EL FALLO QUE ESTA PRUEBA EXISTE PARA IMPEDIR.
 *
 * El 2026-08-21 el prompt vivo decía las dos cosas a la vez: el contrato
 * prohibía todo JavaScript ("llega muerto", "NEVER your own JavaScript") y 792
 * caracteres después el bloque del piloto ofrecía escribir un script. Ganaba la
 * prohibición — 0 de 6 páginas con JavaScript, y en una el modelo escribió
 * `<!-- sin javascript: la página es estática y completa -->`.
 *
 * Nadie lo vio porque ninguna prueba miraba el prompt ENSAMBLADO. Ésta sí.
 */
describe("con el JavaScript abierto, el prompt NO se contradice", () => {
  const PROHIBICIONES = [
    "llega muerto",
    "NO JAVASCRIPT",
    "NEVER your own JavaScript",
    "NO window.X globals",
    "no sobrevive",
  ];

  for (const [nombre, env] of [
    ["contrato completo", ON],
    ["contrato mínimo", ON_MIN],
  ] as const) {
    it(`${nombre}: no queda ni una prohibición de JavaScript`, () => {
      const vivo = systemPromptFor(env) + modelRuntimePromptBlock(env);
      const coladas = PROHIBICIONES.filter((p) => vivo.includes(p));
      expect(coladas, `el prompt todavía prohíbe lo que el sistema acepta: ${coladas.join(", ")}`).toEqual([]);
    });

    it(`${nombre}: y sí dice que el script sobrevive`, () => {
      expect(systemPromptFor(env)).toContain("data-openlen-model-runtime");
    });
  }

  it("el bloque ya no cierra invitando a omitirlo", () => {
    const bloque = modelRuntimePromptBlock(ON);
    expect(bloque).not.toContain("no incluyas el bloque");
    expect(bloque).toContain("Puedes escribir el JavaScript de esta página");
  });

  it("avisa de no esconder contenido tras el script (la trampa del .reveal)", () => {
    expect(systemPromptFor(ON_MIN)).toMatch(/escondas contenido con CSS/);
    expect(modelRuntimePromptBlock(ON)).toMatch(/escondas contenido con CSS/);
  });
});

/**
 * `String.replace` con un literal que se desplazó es un no-op SILENCIOSO:
 * devolvería el prompt prohibitivo y el síntoma sería "el JavaScript del modelo
 * no funciona", nunca "la marca cambió". Por eso lanza, y por eso se prueba.
 */
describe("una marca que ya no existe LANZA, no se ignora", () => {
  it("lanza nombrando la cláusula", () => {
    expect(() => swapJsClauses("un prompt sin la marca", ["contrato-min"], ON)).toThrow(/contrato-min/);
  });

  it("pero con el interruptor apagado no lanza — no hay nada que sustituir", () => {
    expect(swapJsClauses("un prompt sin la marca", ["contrato-min"], OFF)).toBe("un prompt sin la marca");
  });

  it("las marcas siguen existiendo en los contratos de verdad", () => {
    expect(SYSTEM_PROMPT).toContain(clauseMarker("contrato-completo"));
    expect(SYSTEM_PROMPT).toContain(clauseMarker("no-negociable"));
    expect(systemPromptFor({ OPENLEN_MIN_CONTRACT: "1" })).toContain(clauseMarker("contrato-min"));
  });
});

/**
 * El Chat (pestaña de rediseño) monta su prompt igual que crear, y desde el
 * 2026-08-21 también captura el script en modo REESCRITURA. Su cláusula tiene
 * que voltear con el mismo interruptor, o le prometeríamos al modelo algo que su
 * propio contrato le prohíbe.
 */
describe("el Chat monta el mismo prompt sin contradicción", () => {
  const PROHIBICIONES = ["NO JAVASCRIPT", "NEVER your own JavaScript", "NO window.X globals"];

  it("apagado, intacto — ninguna edición normal paga por esto", () => {
    expect(swapJsClauses(CHAT_SYSTEM_PROMPT, ["contrato-completo", "no-negociable"], OFF)).toBe(
      CHAT_SYSTEM_PROMPT,
    );
  });

  it("encendido, no queda ni una prohibición", () => {
    const vivo =
      swapJsClauses(CHAT_SYSTEM_PROMPT, ["contrato-completo", "no-negociable"], ON) +
      modelRuntimePromptBlock(ON);
    expect(PROHIBICIONES.filter((p) => vivo.includes(p))).toEqual([]);
    expect(vivo).toContain("data-openlen-model-runtime");
  });
});

/**
 * EL REDISEÑO DEL AGENTE. Es la tercera superficie que produce un DOCUMENTO
 * entero, así que es la tercera que puede capturar un script — y por eso su
 * cláusula voltea. `editar_pagina` NO: emite ops, no un documento, y prometerle
 * JavaScript a una superficie que no sabe capturarlo entrega botones muertos.
 * Por eso la cláusula `agente` (la del catálogo) se queda prohibitiva.
 */
describe("el rediseño del Agente", () => {
  const REDISENO = buildRedesignPrompt({
    html: "<!doctype html><html><body><h1>hola</h1></body></html>",
    direccion: "más oscuro",
    negocio: null,
    brief: null,
  });

  it("la marca de su cláusula EXISTE — si no, swapJsClauses lanzaría en caliente", () => {
    expect(REDISENO).toContain(clauseMarker("rediseno"));
  });

  it("apagado, el prompt del rediseño no cambia", () => {
    expect(swapJsClauses(REDISENO, ["rediseno"], OFF)).toBe(REDISENO);
  });

  it("encendido, deja de prohibir el JavaScript y nombra el marcador", () => {
    const vivo = swapJsClauses(REDISENO, ["rediseno"], ON) + modelRuntimePromptBlock(ON);
    expect(vivo).not.toContain("NADA de JavaScript propio");
    expect(vivo).toContain("data-openlen-model-runtime");
  });

  // El catálogo gobierna `editar_pagina`, que no captura. Su cláusula NO voltea,
  // y esta prueba existe para que volverla permisiva sea una decisión visible.
  it("la cláusula del catálogo del Agente sigue existiendo, sin aplicarse", () => {
    expect(clauseMarker("agente")).toContain("OpenLen NO ejecuta JavaScript");
  });
});
