import { describe, expect, it } from "vitest";

import { MODEL_POLICY, reasoningEffortFor } from "./model-policy";

describe("Fable model policy", () => {
  it("routes each provider role through the one approved Fireworks model", () => {
    expect(MODEL_POLICY.reasoner.modelId).toBe("accounts/fireworks/models/deepseek-v4-flash-0731");
    expect(MODEL_POLICY.visualCritic.modelId).toBe("accounts/fireworks/models/qwen3p7-plus");
  });

  it.each([
    ["reasoner", "copy", "none"],
    ["reasoner", "simple_extraction", "none"],
    ["visual_critic", "candidate_scouting", "none"],
    ["visual_critic", "final_scoring", "none"],
  ] as const)("uses the bounded reasoning policy for %s/%s", (role, operation, expected) => {
    expect(reasoningEffortFor(role, operation)).toBe(expected);
  });
});
