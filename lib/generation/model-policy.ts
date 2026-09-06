import type { ModelRole, FireworksReasoningEffort } from "../ai/fireworks-contracts";

export const MODEL_POLICY = Object.freeze({
  reasoner: Object.freeze({ modelId: "accounts/fireworks/models/deepseek-v4-flash-0731" }),
  visualCritic: Object.freeze({ modelId: "accounts/fireworks/models/qwen3p7-plus" }),
  // EL AGENTE TIENE PAPEL PROPIO, y no por capricho de tamaño: su trabajo es el
  // único que arrastra estado entre turnos —un bucle de herramientas donde cada
  // llamada depende de lo que devolvió la anterior—, y ahí es donde el modelo
  // chico se atasca. Medido con la batería de 55 casos el 2026-08-28: los dos
  // fallos reales que quedaban los arregla Pro, y en el caso que fallaba gastó
  // 68k tokens contra los 208k que quemaba Flash dando vueltas.
  //
  // NO comparte el papel `reasoner` a propósito. Ese lo piden ADEMÁS el Chat, el
  // rediseño y la pasada de reparación (todos por `page_edit`), y ninguno de los
  // tres tiene continuidad ni la necesita: subirlos costaría 6x sin comprar
  // nada. Un papel aparte es lo que hace que esta decisión sea de UNA línea.
  //
  // ⚠️ CUESTA 6x, parejo: $1.32/$0.044/$3.96 por millón contra $0.22/$0.007/$0.66
  // de Flash (tabla de docs.fireworks.ai/serverless/pricing, 2026-08-28). El
  // cobro lo refleja: `deepseek-pro` en lib/credits.ts. Un turno pesado del
  // Agente pasa de 2 créditos a 12, y el plan FREE son 20 al mes.
  agent: Object.freeze({ modelId: "accounts/fireworks/models/deepseek-v4-pro-0813" }),
});

// ⚰️ AQUÍ VIVÍAN CUATRO OPERACIONES CON CERO LLAMADORES, retiradas el
// 2026-09-06: `creative_direction`, `page_planning`, `initial_section_program` y
// `visual_repair`. Las cuatro eran restos de tuberías que ya no existen —la
// biblioteca de secciones (`2db58d78`) y la pasada de reparación con crítico de
// visión (`446cd428`)— y las dos últimas eran las ÚNICAS que usaban el papel
// `designer`, así que con ellas se va también GLM 5p2 de la política.
//
// Una fila en esta tabla no es documentación: es una decisión de gasto con
// nombre de modelo al lado. Mientras estén escritas se leen como alternativas
// que existen, y la sesión que las lea razonará desde ellas.
//
// La guarda para que no vuelva a pasar está puesta:
// `model-policy-sin-huerfanas.test.ts` recorre el repo y suspende si una
// operación de esta tabla no la nombra nadie.
export type ModelOperation =
  | "copy"
  | "simple_extraction"
  | "candidate_scouting"
  | "final_scoring"
  | "page_edit"
  /** UN turno del Agente: el bucle de herramientas de `lib/agent/brain.ts`.
   *  Existe separada de `page_edit` porque aquélla la comparten el Chat, el
   *  rediseño y la reparación, y sólo ésta tiene continuidad entre turnos. */
  | "agent_turn"
  | "agent_visual_verify"
  | "template_autofill"
  /** Escribir una página MIRANDO una referencia adjunta. Papel con visión: al
   *  razonador nunca se le manda una imagen. */
  | "page_write_with_reference";

const OPERATION_POLICY: Readonly<Record<ModelOperation, { role: ModelRole; effort: FireworksReasoningEffort }>> = {
  // Gusto, no razonamiento: elegir modo y acento desde el brief es una lectura
  // corta, y el fallo ya cae blando a la dirección determinista.
  copy: { role: "reasoner", effort: "none" },
  simple_extraction: { role: "reasoner", effort: "none" },
  candidate_scouting: { role: "visual_critic", effort: "none" },
  final_scoring: { role: "visual_critic", effort: "none" },
  // El Chat editando una página ya escrita. Entró como `high` —editar código
  // PARECE razonar— y la medición lo desmintió sobre la misma página y el mismo
  // prompt: 130.1s y 16,134 tokens de pensamiento para producir DOS ops; en
  // `none`, 5.2s y SIETE. El pensamiento no sólo costaba 25x el tiempo, hacía
  // menos trabajo. Mismo hallazgo que el presupuesto de pensamiento de Gemini
  // en esta misma superficie, y la razón por la que el esfuerzo vive en una
  // tabla: corregirlo fue esta línea.
  page_edit: { role: "reasoner", effort: "none" },
  // Mismo esfuerzo que `page_edit` —pensar más no ayudaba, medido— y otro
  // modelo. Lo que compra Pro aquí no es razonamiento por turno: es no perder el
  // hilo entre turnos.
  agent_turn: { role: "agent", effort: "none" },
  page_write_with_reference: { role: "visual_critic", effort: "none" },
  // Los ojos del Agente: mirar una captura y decir si la edición dejó rotura
  // OBJETIVA. Es el papel con visión, y su esfuerzo es el único que la política
  // le permite — juzgar píxeles no mejora pensando más.
  agent_visual_verify: { role: "visual_critic", effort: "none" },
  // Poner los datos del negocio en una plantilla: sustituir copy, no discurrir.
  // La ruta de Gemini ya lo pedía con `thinkingBudget: 0`, así que `none` no es
  // una apuesta, es la misma decisión escrita en el otro idioma.
  template_autofill: { role: "reasoner", effort: "none" },
};

export function reasoningEffortFor(role: ModelRole, operation: ModelOperation): FireworksReasoningEffort {
  const policy = OPERATION_POLICY[operation];
  if (policy.role !== role) throw new Error("operation is not allowed for model role");
  return policy.effort;
}

/** Qué papel hace una operación. Quien llama nombra el TRABAJO; la política
 *  elige el modelo y el esfuerzo. Es lo que permite cambiar de proveedor
 *  editando una tabla en vez de cada superficie. */
export function roleForOperation(operation: ModelOperation): ModelRole {
  return OPERATION_POLICY[operation].role;
}

export function modelIdForRole(role: ModelRole): string {
  return role === "visual_critic" ? MODEL_POLICY.visualCritic.modelId : MODEL_POLICY[role].modelId;
}

export function reasoningEffortAllowed(role: ModelRole, effort: FireworksReasoningEffort): boolean {
  // Explícito, no por caída al `return` de abajo: un papel nuevo que hereda su
  // esfuerzo permitido por accidente es una decisión que nadie tomó.
  if (role === "agent") return effort === "none";
  if (role === "reasoner") return effort === "none" || effort === "high";
  // ⚰️ Y aquí `designer`, que era el único papel que admitía `"max"`. El
  // esfuerzo sigue en el vocabulario del proveedor —`FireworksReasoningEffort`
  // describe lo que el CABLE acepta, no lo que nosotros pedimos— pero ya no hay
  // papel que lo admita, y eso lo dice la prueba en vez de un comentario.
  return effort === "none";
}
