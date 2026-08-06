import { describe, expect, it, vi } from "vitest";

import type { IntentAnalysis } from "./contracts";
import { selectGenerationRoute } from "./safe-selection";

const INTENT: IntentAnalysis = {
  schemaVersion: "intent-analysis/1.0",
  language: "es",
  functional: {
    siteType: "content_platform",
    requiredSections: ["stories"],
    primaryActions: ["read"],
    contentModel: "catalog",
  },
  audience: { primary: "children", ageRange: "5_10", secondary: ["parents"] },
  domains: ["children_entertainment"],
  emotionalGoals: ["playful"],
  requiredVisualSignals: ["child_friendly_illustration"],
  forbiddenVisualSignals: ["saas_dashboard"],
  explicitConstraints: [],
  ambiguities: [],
  confidence: 0.9,
};

const TEMPLATE = {
  id: "kids",
  visualMetadata: {
    schemaVersion: "template-visual-metadata/1.0" as const,
    domains: ["children_entertainment"],
    audiences: ["children"],
    ageRanges: ["5_10"],
    emotionalRegisters: ["playful"],
    visualArchetypes: ["illustrated_creative_play"],
    visualSignals: ["child_friendly_illustration"],
    layoutTraits: ["image_forward"],
    requiredAssetTypes: ["illustration"],
    negativeTags: [],
    supportedSiteTypes: ["content_platform"],
    supportedSectionRoles: ["stories"],
    themeability: "high" as const,
    identityStrength: "high" as const,
    reviewStatus: "reviewed" as const,
  },
};

function successfulAnalyzer() {
  return vi.fn().mockResolvedValue({
    ok: true,
    intent: INTENT,
    modelId: "test-model",
    promptVersion: "intent-prompt/1.5",
    usage: { inputTokens: 10, outputTokens: 20 },
    durationMs: 3,
  });
}

describe("safe selection", () => {
  it("returns the analyzed intent, ranked candidates, and route decision", async () => {
    const result = await selectGenerationRoute("brief", [TEMPLATE], {
      analyzeIntentImpl: successfulAnalyzer(),
      now: (() => {
        const values = [100, 108];
        return () => values.shift() ?? 108;
      })(),
    });

    expect(result).toMatchObject({
      ok: true,
      intent: INTENT,
      promptVersion: "intent-prompt/1.5",
      policyVersion: "template-policy/1.0",
      modelId: "test-model",
      usage: { inputTokens: 10, outputTokens: 20 },
      decision: { route: "template_full", templateId: "kids" },
      durationMs: 8,
    });
    if (result.ok) expect(result.ranked.map((candidate) => candidate.id)).toEqual(["kids"]);
  });

  it("preserves typed analyzer failures without their messages", async () => {
    const result = await selectGenerationRoute("brief", [TEMPLATE], {
      analyzeIntentImpl: vi.fn().mockResolvedValue({
        ok: false,
        modelId: "test-model",
        promptVersion: "intent-prompt/1.5",
        error: { kind: "schema", message: "sensitive provider output" },
        durationMs: 3,
      }),
    });

    expect(result).toEqual(expect.objectContaining({ ok: false, errorKind: "schema" }));
    expect(JSON.stringify(result)).not.toContain("sensitive provider output");
  });

  it("normalizes unexpected analyzer exceptions to a stable error name", async () => {
    await expect(selectGenerationRoute("brief", [TEMPLATE], {
      analyzeIntentImpl: vi.fn().mockRejectedValue(new RangeError("secret")),
    })).resolves.toEqual(expect.objectContaining({ ok: false, errorKind: "unexpected_error" }));
  });

  it("keeps ranking deterministic and clamps backwards durations to zero", async () => {
    const result = await selectGenerationRoute("brief", [
      { ...TEMPLATE, id: "zebra" },
      { ...TEMPLATE, id: "alpha" },
    ], {
      analyzeIntentImpl: successfulAnalyzer(),
      now: (() => {
        const values = [100, 95];
        return () => values.shift() ?? 95;
      })(),
    });

    expect(result).toEqual(expect.objectContaining({ ok: true, durationMs: 0 }));
    if (result.ok) expect(result.ranked.map((candidate) => candidate.id)).toEqual(["alpha", "zebra"]);
  });
});
