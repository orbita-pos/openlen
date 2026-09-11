import { describe, expect, it } from "vitest";

import { MODEL_POLICY, esfuerzoDisponible, reasoningEffortFor } from "./model-policy";

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

describe("el interruptor de pensamiento está SEPARADO del mando", () => {
  it("el papel `agent` declara si piensa, y hoy piensa", () => {
    expect(MODEL_POLICY.agent.piensa).toBe(true);
  });

  it("con el pensamiento encendido, los niveles están disponibles", () => {
    expect(esfuerzoDisponible("high")).toEqual({ ok: true });
    expect(esfuerzoDisponible("auto")).toEqual({ ok: true });
  });
});
