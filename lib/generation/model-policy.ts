import type { ModelRole, FireworksReasoningEffort } from "../ai/fireworks-contracts";

export const MODEL_POLICY = Object.freeze({
  reasoner: Object.freeze({ modelId: "accounts/fireworks/models/deepseek-v4-flash-0731" }),
  designer: Object.freeze({ modelId: "accounts/fireworks/models/glm-5p2" }),
  visualCritic: Object.freeze({ modelId: "accounts/fireworks/models/qwen3p7-plus" }),
});

export type ModelOperation =
  | "creative_direction"
  | "copy"
  | "simple_extraction"
  | "page_planning"
  | "initial_section_program"
  | "visual_repair"
  | "candidate_scouting"
  | "final_scoring"
  | "page_edit"
  | "agent_visual_verify"
  | "template_autofill"
  /** Escribir una página MIRANDO una referencia adjunta. Papel con visión: al
   *  razonador nunca se le manda una imagen. */
  | "page_write_with_reference";

const OPERATION_POLICY: Readonly<Record<ModelOperation, { role: ModelRole; effort: FireworksReasoningEffort }>> = {
  // Gusto, no razonamiento: elegir modo y acento desde el brief es una lectura
  // corta, y el fallo ya cae blando a la dirección determinista.
  creative_direction: { role: "reasoner", effort: "none" },
  copy: { role: "reasoner", effort: "none" },
  simple_extraction: { role: "reasoner", effort: "none" },
  page_planning: { role: "reasoner", effort: "high" },
  initial_section_program: { role: "designer", effort: "high" },
  visual_repair: { role: "designer", effort: "max" },
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
  if (role === "reasoner") return effort === "none" || effort === "high";
  if (role === "designer") return effort === "high" || effort === "max";
  return effort === "none";
}
