import { describe, expect, it } from "vitest";

import { swapJsClauses, clauseMarker } from "./js-clause";
import { modelRuntimePromptBlock } from "../ai-stream/model-runtime";
import { SYSTEM_PROMPT as CHAT_SYSTEM_PROMPT } from "../../app/api/templates/ai-design/system-prompt";
import { instruccionesDeLen } from "../agent/catalog";

// ⚰️ Las pruebas sobre el prompt de CREAR (`systemPromptFor` de
// `app/api/generate/system-prompt.ts`, en sus contratos completo y mínimo) se
// fueron con la ruta el 2026-10-06 (plans/crear-es-len, tarea 12). Lo que
// vigilaban de las superficies que quedan —que ninguna prohíba el JavaScript
// que se acepta— lo miran `js-clause-superficies.test.ts` y el bloque del Chat
// de aquí abajo.

// RETIRADO el 2026-08-26 con el interruptor. Fijaba que con `OPENLEN_MODEL_JS`
// apagado el prompt saliera INTACTO —ni un carácter de coste para quien no
// usaba el piloto— y que las CONDUCTAS siguieran enteras, «que son la única
// interactividad que hay». Esa frase era verdad y es justo la que dejó de
// serlo: ahora la interactividad la escribe el modelo.

describe("con JS libre, las conductas desaparecen del prompt", () => {
  it("el Chat las cambia por «escríbela tú»", () => {
    const vivo = swapJsClauses(CHAT_SYSTEM_PROMPT, ["contrato-completo", "conductas", "no-negociable"]);
    expect(vivo).not.toContain("data-ol-sticky");
    expect(vivo).toContain("INTERACTIVITY — YOU write it");
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

  it("el bloque del JavaScript no trae ninguna prohibición", () => {
    const bloque = modelRuntimePromptBlock();
    const coladas = PROHIBICIONES.filter((p) => bloque.includes(p));
    expect(coladas, `el bloque todavía prohíbe lo que el sistema acepta: ${coladas.join(", ")}`).toEqual([]);
  });

  it("el bloque ya no cierra invitando a omitirlo", () => {
    const bloque = modelRuntimePromptBlock();
    expect(bloque).not.toContain("no incluyas el bloque");
    expect(bloque).toContain("You may write this page's JavaScript");
  });

  it("avisa de no esconder contenido tras el script (la trampa del .reveal)", () => {
    expect(modelRuntimePromptBlock()).toMatch(/hide content (in|with) CSS/i);
  });
});

/**
 * `String.replace` con un literal que se desplazó es un no-op SILENCIOSO:
 * devolvería el prompt prohibitivo y el síntoma sería "el JavaScript del modelo
 * no funciona", nunca "la marca cambió". Por eso lanza, y por eso se prueba.
 */
describe("una marca que ya no existe LANZA, no se ignora", () => {
  it("lanza nombrando la cláusula", () => {
    expect(() => swapJsClauses("un prompt sin la marca", ["contrato-min"])).toThrow(/contrato-min/);
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
 * El Chat (pestaña de rediseño) monta su prompt igual que crear lo montaba, y desde el
 * 2026-08-21 también captura el script en modo REESCRITURA. Su cláusula tiene
 * que voltear con el mismo interruptor, o le prometeríamos al modelo algo que su
 * propio contrato le prohíbe.
 */
describe("el Chat monta el mismo prompt sin contradicción", () => {
  const PROHIBICIONES = ["NO JAVASCRIPT", "NEVER your own JavaScript", "NO window.X globals"];

  it("encendido, no queda ni una prohibición", () => {
    const vivo =
      swapJsClauses(CHAT_SYSTEM_PROMPT, ["contrato-completo", "no-negociable"]) +
      modelRuntimePromptBlock();
    expect(PROHIBICIONES.filter((p) => vivo.includes(p))).toEqual([]);
    expect(vivo).toContain("<script>");
  });
});

describe("la cláusula del Agente", () => {
  it("el catálogo de Len voltea su cláusula: su JavaScript vive en el fichero y se edita con Edit", () => {
    const vivo = instruccionesDeLen();
    expect(vivo).not.toContain(clauseMarker("agente"));
    expect(vivo).toContain("<script>");
  });
});

// ⚰️ «cómo se le enseña a guardar en un almacén» (2026-09-18): vigilaba que
// todas las superficies que escriben JavaScript dieran la ruta de `/api/d` sin
// subdominio y el carrito entero en un POST. `data-ol-stores` y `/api/d` se
// retiraron el 2026-10-04: lo que la página guarda va al backend de Supabase
// (supabase-js), que enseña THE BACKEND en el manual de Len.
