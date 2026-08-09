import { describe, expect, it, vi } from "vitest";

import type { IntentAnalysis } from "./contracts";
import {
  compareShadowWithCurrent,
  logShadowComparisonWhenReady,
  runShadowSelection,
  safeTemplatePickerMode,
} from "./shadow-selection";

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
    promptVersion: "intent-prompt/1.6",
    usage: { inputTokens: 10, outputTokens: 20 },
    durationMs: 3,
  });
}

describe("safe template picker shadow", () => {
  it("treats every unsupported mode, including on, as off", () => {
    expect(safeTemplatePickerMode("on")).toBe("off");
    expect(safeTemplatePickerMode("SHADOW")).toBe("off");
    expect(safeTemplatePickerMode("shadow")).toBe("shadow");
  });

  it("does not call the analyzer in off mode", async () => {
    const analyze = successfulAnalyzer();

    expect(await runShadowSelection("brief", [TEMPLATE], {
      mode: "off",
      analyzeIntentImpl: analyze,
    })).toBeNull();
    expect(analyze).not.toHaveBeenCalled();
  });

  it("keeps the existing off gate and maps active selection into the shadow schema", async () => {
    const analyze = successfulAnalyzer();

    expect(await runShadowSelection("brief", [TEMPLATE], {
      mode: "off",
      analyzeIntentImpl: analyze,
    })).toBeNull();
    expect(analyze).not.toHaveBeenCalled();

    await expect(runShadowSelection("brief", [TEMPLATE], {
      mode: "shadow",
      analyzeIntentImpl: successfulAnalyzer(),
    })).resolves.toMatchObject({
      status: "ok",
      schemaVersion: "safe-selection-shadow/1.0",
      decision: { route: "template_full", templateId: "kids" },
    });
  });

  it("normalizes an unsupported runtime option to off", async () => {
    const analyze = successfulAnalyzer();

    expect(await runShadowSelection("brief", [TEMPLATE], {
      mode: "on" as "shadow",
      analyzeIntentImpl: analyze,
    })).toBeNull();
    expect(analyze).not.toHaveBeenCalled();
  });

  it("returns a deterministic, redacted decision in shadow mode", async () => {
    const analyze = successfulAnalyzer();
    const result = await runShadowSelection("secret brief <html apiKey", [TEMPLATE], {
      mode: "shadow",
      analyzeIntentImpl: analyze,
      now: () => 100,
    });

    expect(result).toMatchObject({
      status: "ok",
      schemaVersion: "safe-selection-shadow/1.0",
      promptVersion: "intent-prompt/1.6",
      policyVersion: "template-policy/1.0",
      modelId: "test-model",
      decision: { route: "template_full", templateId: "kids" },
      usage: { inputTokens: 10, outputTokens: 20 },
      durationMs: 0,
    });
    expect(analyze).toHaveBeenCalledWith("secret brief <html apiKey");
    expect(JSON.stringify(result)).not.toContain("secret brief");
    expect(JSON.stringify(result)).not.toContain("<html");
    expect(JSON.stringify(result)).not.toContain("apiKey");
  });

  it("limits logs to the top five scored candidates", async () => {
    const templates = Array.from({ length: 7 }, (_, index) => ({
      ...TEMPLATE,
      id: `template-${index}`,
    }));

    const result = await runShadowSelection("brief", templates, {
      mode: "shadow",
      analyzeIntentImpl: successfulAnalyzer(),
    });

    expect(result?.status).toBe("ok");
    if (result?.status === "ok") expect(result.topCandidates).toHaveLength(5);
  });

  it("records typed analyzer failure instead of throwing or logging its message", async () => {
    const analyze = vi.fn().mockResolvedValue({
      ok: false,
      modelId: "test-model",
      promptVersion: "intent-prompt/1.6",
      error: { kind: "schema", message: "sensitive provider output" },
      durationMs: 3,
    });

    const result = await runShadowSelection("brief", [TEMPLATE], {
      mode: "shadow",
      analyzeIntentImpl: analyze,
    });

    expect(result).toMatchObject({ status: "error", errorKind: "schema" });
    expect(JSON.stringify(result)).not.toContain("sensitive provider output");
  });

  it("records unexpected failures by stable error name", async () => {
    const analyze = vi.fn().mockRejectedValue(new RangeError("secret"));

    await expect(runShadowSelection("brief", [TEMPLATE], {
      mode: "shadow",
      analyzeIntentImpl: analyze,
    })).resolves.toMatchObject({ status: "error", errorKind: "unexpected_error" });
  });

  it("builds a structured comparison without changing the shadow decision", async () => {
    const shadow = await runShadowSelection("brief", [TEMPLATE], {
      mode: "shadow",
      analyzeIntentImpl: successfulAnalyzer(),
    });
    expect(shadow).not.toBeNull();
    if (!shadow) return;

    expect(compareShadowWithCurrent(shadow, "kids")).toMatchObject({
      currentTemplateId: "kids",
      agreesWithCurrent: true,
      decision: { templateId: "kids" },
    });
    expect(compareShadowWithCurrent(shadow, "current-picker")).toMatchObject({
      currentTemplateId: "current-picker",
      agreesWithCurrent: false,
    });
  });

  it("logs the comparison asynchronously without putting shadow work on the caller path", async () => {
    const shadow = await runShadowSelection("brief", [TEMPLATE], {
      mode: "shadow",
      analyzeIntentImpl: successfulAnalyzer(),
    });
    expect(shadow).not.toBeNull();
    if (!shadow) return;

    type ResolvedShadow = NonNullable<typeof shadow>;
    let resolveShadow!: (value: ResolvedShadow) => void;
    const pending = new Promise<ResolvedShadow>((resolve) => {
      resolveShadow = resolve;
    });
    const logger = vi.fn();
    const logging = logShadowComparisonWhenReady(pending, "kids", logger);

    expect(logger).not.toHaveBeenCalled();
    resolveShadow(shadow);
    await logging;
    expect(logger).toHaveBeenCalledWith(
      "[safe-template-shadow]",
      expect.stringContaining('"agreesWithCurrent":true'),
    );
  });

  it("absorbs an unexpected shadow promise rejection without logging details", async () => {
    const logger = vi.fn();

    await expect(logShadowComparisonWhenReady(
      Promise.reject(new Error("sensitive")),
      "kids",
      logger,
    )).resolves.toBeUndefined();
    expect(logger).not.toHaveBeenCalled();
  });
});
