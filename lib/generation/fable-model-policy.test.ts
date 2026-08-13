import { describe, expect, it } from "vitest";

import { FABLE_MODEL_POLICY, reasoningEffortFor } from "./fable-model-policy";

describe("Fable model policy", () => {
  it("routes each provider role through the one approved Fireworks model", () => {
    expect(FABLE_MODEL_POLICY.reasoner.modelId).toBe("accounts/fireworks/models/deepseek-v4-flash");
    expect(FABLE_MODEL_POLICY.designer.modelId).toBe("accounts/fireworks/models/glm-5p2");
    expect(FABLE_MODEL_POLICY.visualCritic.modelId).toBe("accounts/fireworks/models/qwen3p7-plus");
  });

  it.each([
    ["reasoner", "copy", "none"],
    ["reasoner", "simple_extraction", "none"],
    ["reasoner", "page_planning", "high"],
    ["designer", "initial_section_program", "high"],
    ["designer", "visual_repair", "max"],
    ["visual_critic", "candidate_scouting", "none"],
    ["visual_critic", "final_scoring", "none"],
  ] as const)("uses the bounded reasoning policy for %s/%s", (role, operation, expected) => {
    expect(reasoningEffortFor(role, operation)).toBe(expected);
  });
});
