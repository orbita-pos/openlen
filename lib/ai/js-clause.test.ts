import { describe, expect, it } from "vitest";

import { swapJsClauses, clauseMarker } from "./js-clause";
import { SYSTEM_PROMPT, systemPromptFor } from "../../app/api/generate/system-prompt";
import { modelRuntimePromptBlock } from "../ai-stream/model-runtime";
import { SYSTEM_PROMPT as CHAT_SYSTEM_PROMPT } from "../../app/api/templates/ai-design/system-prompt";
import { buildAgentSystemPrompt } from "../agent/catalog";
import { buildRedesignPrompt } from "../agent/redesign";

const OFF = {} as const;
const ON = { OPENLEN_MODEL_JS: "1" } as const;
const ON_MIN = { OPENLEN_MODEL_JS: "1", OPENLEN_MIN_CONTRACT: "1" } as const;
// El contrato MÍNIMO pasó a ser el DEFECTO el 2026-08-23. Para probar el
// completo hay que pedirlo: sin esto media suite mediría el prompt equivocado y
// pasaría por el motivo que no es.
const COMPLETO = { OPENLEN_MIN_CONTRACT: "0" } as const;
const ON_COMPLETO = { OPENLEN_MODEL_JS: "1", OPENLEN_MIN_CONTRACT: "0" } as const;

// RETIRADO el 2026-08-26 con el interruptor. Fijaba que con `OPENLEN_MODEL_JS`
// apagado el prompt saliera INTACTO —ni un carácter de coste para quien no
// usaba el piloto— y que las CONDUCTAS siguieran enteras, «que son la única
// interactividad que hay». Esa frase era verdad y es justo la que dejó de
// serlo: ahora la interactividad la escribe el modelo.

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
    expect(real).toContain("<script>");
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
      expect(systemPromptFor(env)).toContain("<script>");
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

  // Contra el contrato CRUDO, no contra el prompt ensamblado: desde el
  // 2026-08-26 el volteo es incondicional, así que el prompt que sale ya NO
  // lleva las marcas — se las acaba de comer el propio volteo. Lo que hay que
  // clavar es que sigan existiendo en el contrato, porque son lo que
  // `swapJsClauses` busca: si alguien las renombra, tiene que LANZAR y no
  // dejar pasar en silencio un prompt que sigue prohibiendo el JavaScript.
  it("las marcas siguen existiendo en los contratos de verdad", async () => {
    const { PUBLISH_CONTRACT } = await import("@/lib/design-guidance");
    const { PUBLISH_CONTRACT_MIN } = await import("@/lib/publish-contract-min");
    expect(PUBLISH_CONTRACT).toContain(clauseMarker("contrato-completo"));
    expect(PUBLISH_CONTRACT_MIN).toContain(clauseMarker("contrato-min"));
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

  it("encendido, no queda ni una prohibición", () => {
    const vivo =
      swapJsClauses(CHAT_SYSTEM_PROMPT, ["contrato-completo", "no-negociable"], ON) +
      modelRuntimePromptBlock(ON);
    expect(PROHIBICIONES.filter((p) => vivo.includes(p))).toEqual([]);
    expect(vivo).toContain("<script>");
  });
});

/**
 * EL REDISEÑO DEL AGENTE produce un documento entero y captura su script.
 * El Agente normal también captura runtime desde 86757c05: `editar_pagina`
 * separa un edit con target="runtime" y persiste la cápsula. Por eso tanto la
 * cláusula `rediseno` como la cláusula `agente` pueden voltear.
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

  it("encendido, deja de prohibir el JavaScript y le ofrece el <script>", () => {
    const vivo = swapJsClauses(REDISENO, ["rediseno"], ON) + modelRuntimePromptBlock(ON);
    expect(vivo).not.toContain("NADA de JavaScript propio");
    expect(vivo).toContain("<script>");
  });

  it("el catálogo de Len voltea su cláusula porque editar_pagina captura runtime", () => {
    const vivo = buildAgentSystemPrompt(ON);
    expect(vivo).not.toContain(clauseMarker("agente"));
    expect(vivo).toContain("<script>");
  });
});
