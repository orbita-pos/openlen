import { describe, expect, it } from "vitest";

import { reasoningEffortFor, roleForOperation } from "@/lib/generation/model-policy";

import { APP_AI_MODELS, MAX_TOKENS_CEILING, appAiModel } from "./models";

describe("app AI models", () => {
  it("knows the two aliases and nothing else", () => {
    expect(APP_AI_MODELS.map((m) => m.id)).toEqual(["openlen-fast", "openlen-smart"]);
    expect(appAiModel("openlen-fast")?.operation).toBe("app_ai_fast");
    expect(appAiModel("openlen-smart")?.operation).toBe("app_ai_smart");
    expect(appAiModel("gpt-4o")).toBeNull();
    expect(appAiModel("")).toBeNull();
  });

  it("fast does not think and smart does, both on the reasoner", () => {
    expect(roleForOperation("app_ai_fast")).toBe("reasoner");
    expect(roleForOperation("app_ai_smart")).toBe("reasoner");
    expect(reasoningEffortFor("reasoner", "app_ai_fast")).toBe("none");
    expect(reasoningEffortFor("reasoner", "app_ai_smart")).toBe("high");
  });

  it("the defaults stay under the ceiling", () => {
    expect(appAiModel("openlen-fast")?.defaultMaxTokens).toBe(2_048);
    expect(appAiModel("openlen-smart")?.defaultMaxTokens).toBe(8_192);
    for (const m of APP_AI_MODELS) expect(m.defaultMaxTokens).toBeLessThanOrEqual(MAX_TOKENS_CEILING);
  });
});
