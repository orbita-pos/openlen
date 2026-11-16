// lib/ai/policy-models.test.ts
// @vitest-environment node
//
// WHAT `npm run modelos:comprobar` ASKS, AND WHERE. Until the judge (15/11) every role's `modelId` was a
// Fireworks model and the script only knew Fireworks; the judge is DeepInfra's, so the script asks each
// provider the policy names, and checks each role's price where that price comes from.
import { describe, expect, it } from "vitest";

import { deepinfraListPrice, deepinfraServesItself, policyModels, tariffedProvider } from "./policy-models";
import { MODEL_POLICY } from "@/lib/generation/model-policy";

describe("policyModels — every (provider, model) the policy names, once", () => {
  it("a role without providers is Fireworks with its modelId; a role with providers is each of them", () => {
    const pairs = policyModels();
    const has = (provider: string, modelId: string) => pairs.some((p) => p.provider === provider && p.modelId === modelId);
    expect(has("fireworks", MODEL_POLICY.reasoner.modelId)).toBe(true);
    for (const p of MODEL_POLICY.agent.providers) expect(has(p.provider, p.modelId)).toBe(true);
    expect(has("deepinfra", MODEL_POLICY.judge.modelId)).toBe(true);
    expect(has("fireworks", MODEL_POLICY.judge.modelId)).toBe(false);
  });
  it("a model two roles share is asked once, naming both", () => {
    const shared = policyModels().find((p) => p.provider === "fireworks" && p.modelId === MODEL_POLICY.reasoner.modelId)!;
    expect(shared.roles).toEqual(expect.arrayContaining(["reasoner", "visualCritic", "agent"]));
    expect(policyModels().filter((p) => p.provider === "fireworks" && p.modelId === MODEL_POLICY.reasoner.modelId)).toHaveLength(1);
  });
});

describe("tariffedProvider — whose price a role's creditRate declares", () => {
  it("the provider its modelId belongs to: Fireworks for Len (billed at Fireworks' price), DeepInfra for the judge", () => {
    expect(tariffedProvider(MODEL_POLICY.agent)).toBe("fireworks");
    expect(tariffedProvider(MODEL_POLICY.reasoner)).toBe("fireworks");
    expect(tariffedProvider(MODEL_POLICY.judge)).toBe("deepinfra");
  });
});

describe("deepinfraListPrice — the list price from DeepInfra's public models list", () => {
  const list = [
    { model_name: "Qwen/Qwen3.8-Flash", type: "text-generation", pricing: { type: "tokens", cents_per_input_token: 0.0000113, cents_per_output_token: 0.0000382, rate_per_input_token_cached: 0.12477876 } },
    { model_name: "other/model", type: "text-generation", pricing: { type: "tokens", cents_per_input_token: 0.00002, cents_per_output_token: 0.00006 } },
  ];
  it("in dollars per million, the cached price as its share of the input", () => {
    const p = deepinfraListPrice(list, "Qwen/Qwen3.8-Flash");
    expect(typeof p).toBe("object");
    if (typeof p === "string") return;
    expect(p.input).toBeCloseTo(0.113, 9);
    expect(p.output).toBeCloseTo(0.382, 9);
    expect(p.cached).toBeCloseTo(0.113 * 0.12477876, 9);
  });
  it("a model without a cached price says so; an absent model says it is absent", () => {
    expect(deepinfraListPrice(list, "other/model")).toMatch(/caché/);
    expect(deepinfraListPrice(list, "nope/nope")).toMatch(/no aparece/);
    expect(deepinfraListPrice({ not: "a list" }, "Qwen/Qwen3.8-Flash")).toMatch(/lista/);
  });
});

// The judge reads customers' requests and pages. 15/11: Qwen3.8-Flash was a partner's model on DeepInfra — handed
// on, and the partner's moderation refused a customer's page (data_inspection_failed).
describe("deepinfraServesItself — a model DeepInfra serves, not one it hands to a partner", () => {
  it("served by DeepInfra passes; a partner's says so; one the list says nothing about is not a pass", () => {
    expect(deepinfraServesItself([{ model_name: "a/own", is_partner: false }], "a/own")).toBe(true);
    expect(deepinfraServesItself([{ model_name: "a/partner", is_partner: true }], "a/partner")).toMatch(/socio/);
    expect(deepinfraServesItself([{ model_name: "a/silent" }], "a/silent")).toMatch(/no dice/);
    expect(deepinfraServesItself([], "a/none")).toMatch(/no aparece/);
    expect(deepinfraServesItself({ not: "a list" }, "a/none")).toMatch(/lista/);
  });
  it("the judge is Qwen3.8-27B, open weights, which DeepInfra's list showed as its own on 15/11", () => {
    expect(MODEL_POLICY.judge.modelId).toBe("Qwen/Qwen3.8-27B");
    expect(MODEL_POLICY.judge.providers.map((p) => [p.provider, p.modelId])).toEqual([["deepinfra", "Qwen/Qwen3.8-27B"]]);
  });
});
