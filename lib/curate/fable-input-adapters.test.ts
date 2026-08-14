import { describe, expect, it, vi } from "vitest";

import { createFableInputAdapters } from "./fable-input-adapters";

const intent = {
  schemaVersion: "intent-analysis/1.0", language: "es",
  functional: { siteType: "content_platform", requiredSections: ["hero", "activities", "footer"], primaryActions: ["create"], contentModel: "creative_play" },
  audience: { primary: "children", ageRange: null, secondary: ["parents"] }, domains: ["creative_play"], emotionalGoals: ["playful"],
  requiredVisualSignals: ["hand_drawn"], forbiddenVisualSignals: ["saas_dashboard"], explicitConstraints: [], ambiguities: [], confidence: .9,
};

describe("Fable DeepSeek input adapters", () => {
  it("uses one Fireworks reasoner boundary for strict intent and lenient page copy, never a Gemini text route", async () => {
    const request = vi.fn(async (input) => ({
      ok: true as const,
      value: input.responseSchema.parse(input.requestId.endsWith("intent") ? intent : { schemaVersion: "page-copy/1.0", copy: { business_name: "Mundo Pincel", features: [] } }),
      modelId: "accounts/fireworks/models/deepseek-v4-flash-0731", usage: { inputTokens: 2, cachedTokens: 0, outputTokens: 2, thinkingTokens: 0 }, durationMs: 1, attempts: 1 as const,
    }));
    const adapters = createFableInputAdapters({ client: { request } as never });

    const [intentResult, copyResult] = await Promise.all([
      adapters.analyzeIntent("Una pagina para colorear", "page-1"),
      adapters.generatePageCopy("Una pagina para colorear", "page-1"),
    ]);

    expect(intentResult).toMatchObject({ ok: true, intent: { functional: { siteType: "content_platform" } } });
    expect(copyResult).toMatchObject({ ok: true, copy: { business_name: "Mundo Pincel" } });
    expect(request).toHaveBeenNthCalledWith(1, expect.objectContaining({ role: "reasoner", requestId: "page-1.intent" }));
    expect(request).toHaveBeenNthCalledWith(2, expect.objectContaining({ role: "reasoner", requestId: "page-1.copy" }));
    expect(JSON.stringify(request.mock.calls)).not.toMatch(/gemini|googleapis|generativelanguage/i);
  });

  it("rejects noncanonical site types and section roles at the DeepSeek boundary", async () => {
    const request = vi.fn(async (input) => {
      const parsed = input.responseSchema.safeParse({
        ...intent,
        functional: { ...intent.functional, siteType: "coloring_pages", requiredSections: ["hero", "categories", "activities"] },
      });
      return parsed.success
        ? { ok: true as const, value: parsed.data, modelId: "accounts/fireworks/models/deepseek-v4-flash-0731", usage: { inputTokens: 2, cachedTokens: 0, outputTokens: 2, thinkingTokens: 0 }, durationMs: 1, attempts: 1 as const }
        : { ok: false as const, code: "schema", modelId: "accounts/fireworks/models/deepseek-v4-flash-0731", durationMs: 1, attempts: 1 as const };
    });
    const result = await createFableInputAdapters({ client: { request } as never })
      .analyzeIntent("Una pagina para colorear", "page-2");
    expect(result).toMatchObject({ ok: false, code: "schema" });
  });

  it("deduplicates canonical requested roles before section planning", async () => {
    const request = vi.fn(async (input) => ({
      ok: true as const,
      value: input.responseSchema.parse({
        ...intent,
        functional: { ...intent.functional, requiredSections: ["hero", "activities", "activities", "footer"] },
      }),
      modelId: "accounts/fireworks/models/deepseek-v4-flash-0731",
      usage: { inputTokens: 2, cachedTokens: 0, outputTokens: 2, thinkingTokens: 0 },
      durationMs: 1,
      attempts: 1 as const,
    }));
    const result = await createFableInputAdapters({ client: { request } as never })
      .analyzeIntent("Una pagina para colorear", "page-3");
    expect(result).toMatchObject({ ok: true, intent: { functional: { requiredSections: ["hero", "activities", "footer"] } } });
  });
});
