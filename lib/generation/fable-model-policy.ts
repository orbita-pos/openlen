import type { FableModelRole, FireworksReasoningEffort } from "../ai/fireworks-contracts";

export const FABLE_MODEL_POLICY = Object.freeze({
  reasoner: Object.freeze({ modelId: "accounts/fireworks/models/deepseek-v4-flash-0731" }),
  designer: Object.freeze({ modelId: "accounts/fireworks/models/glm-5p2" }),
  visualCritic: Object.freeze({ modelId: "accounts/fireworks/models/qwen3p7-plus" }),
});

export type FableModelOperation =
  | "creative_direction"
  | "copy"
  | "simple_extraction"
  | "page_planning"
  | "initial_section_program"
  | "visual_repair"
  | "candidate_scouting"
  | "final_scoring";

const OPERATION_POLICY: Readonly<Record<FableModelOperation, { role: FableModelRole; effort: FireworksReasoningEffort }>> = {
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
};

export function reasoningEffortFor(role: FableModelRole, operation: FableModelOperation): FireworksReasoningEffort {
  const policy = OPERATION_POLICY[operation];
  if (policy.role !== role) throw new Error("operation is not allowed for model role");
  return policy.effort;
}

export function modelIdForRole(role: FableModelRole): string {
  return role === "visual_critic" ? FABLE_MODEL_POLICY.visualCritic.modelId : FABLE_MODEL_POLICY[role].modelId;
}

export function reasoningEffortAllowed(role: FableModelRole, effort: FireworksReasoningEffort): boolean {
  if (role === "reasoner") return effort === "none" || effort === "high";
  if (role === "designer") return effort === "high" || effort === "max";
  return effort === "none";
}
