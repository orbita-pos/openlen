import { describe, expect, it, vi } from "vitest";
import type { AssetResolutionTrace } from "./asset-contracts";
import { applyVisualRepairPlan } from "./apply-visual-repair";
import { CreativeDirectionSchema } from "./creative-contracts";
import { IntentAnalysisSchema } from "./contracts";
import { runClosedLoopVisualRepair, repairImprovesQuality, shouldAttemptVisualRepair, type ClosedLoopVisualRepairDeps } from "./closed-loop-repair";
import { COLORING_DIRECTION, COLORING_INTENT } from "./creative-fixtures.test-support";
import { VisualQualityVerdictSchema, type VisualQualityScores } from "./visual-repair-contracts";

const scores = { themeRecognition: 5, visualHierarchy: 7, componentCoherence: 7, mobileReadability: 8, imageryRelevance: 6, briefAdherence: 5 };
const BEFORE = VisualQualityVerdictSchema.parse({ schemaVersion: "visual-quality-verdict/2.1", decision: "repair", nonrepairableReason: "none", scores, issues: [{ code: "palette_mismatch", severity: "critical", hookId: null, explanation: "Palette misses the intended mood." }] });
const AFTER = VisualQualityVerdictSchema.parse({ schemaVersion: "visual-quality-verdict/2.1", decision: "keep", nonrepairableReason: "none", scores: { ...scores, themeRecognition: 7, imageryRelevance: 7, briefAdherence: 7 }, issues: [] });
const KEEP = VisualQualityVerdictSchema.parse({ ...AFTER, scores: { ...AFTER.scores, themeRecognition: 9 } });
const NONREPAIRABLE = VisualQualityVerdictSchema.parse({ ...BEFORE, decision: "nonrepairable", nonrepairableReason: "primary_content_hidden", scores: { ...BEFORE.scores, mobileReadability: 2 }, issues: [] });
const INPUT = { html: "<html>original</html>", metadata: { route: "template_skeleton" }, sourceId: "fixture", intent: IntentAnalysisSchema.parse(COLORING_INTENT), direction: CreativeDirectionSchema.parse(COLORING_DIRECTION), route: "template_skeleton" as const };
const ASSET_MANIFEST = { schemaVersion: "asset-manifest/1.0", manifestId: `sha256:${"f".repeat(64)}` } as never;
const ASSET_TRACE: AssetResolutionTrace = {
  schemaVersion: "asset-resolution-trace/1.0", manifestId: `sha256:${"f".repeat(64)}`,
  consistencyGroupCount: 1, curatedCount: 0, generatedCount: 1, abstractCount: 0,
  placeholderCount: 0, requiredUnresolvedCount: 0, rejectionCounts: {}, provider: "gemini",
  modelId: "gemini-image-test", promptSha256: [`sha256:${"b".repeat(64)}`],
  usage: { inputTokens: 31, outputTokens: 7, cachedTokens: 3, thinkingTokens: 2 },
  estimatedCostMicromxn: 456, durationMs: 19, resultCode: "resolved",
};
const images = { desktop: { mimeType: "image/jpeg", dataBase64: "ZA==" }, mobile: { mimeType: "image/jpeg", dataBase64: "bQ==" } };
const criticSuccess = (verdict: unknown) => ({ ok: true as const, verdict, durationMs: 1, promptVersion: "visual-quality-critic/2.4" as const, modelId: "critic-test" });
const criticFailure = { ok: false as const, kind: "provider_error" as const, durationMs: 1, promptVersion: "visual-quality-critic/2.4" as const, modelId: "critic-test" };

function deps(first: unknown = BEFORE, second: unknown = AFTER) {
  const asResult = (value: unknown) => value && typeof value === "object" && "ok" in value ? value : criticSuccess(value);
  const critic = vi.fn<ClosedLoopVisualRepairDeps["critic"]>().mockResolvedValueOnce(asResult(first) as never).mockResolvedValueOnce(asResult(second) as never);
  const render = vi.fn<ClosedLoopVisualRepairDeps["render"]>(async () => images);
  const generatePlan = vi.fn<ClosedLoopVisualRepairDeps["generatePlan"]>(async () => ({ ok: true, plan: { schemaVersion: "skeleton-adaptation-plan/1.0", tokens: {}, cssOverride: [], assets: [] }, promptVersion: "visual-repair-prompt/1.1", durationMs: 1 }));
  const applyPlan = vi.fn<ClosedLoopVisualRepairDeps["applyPlan"]>(async () => ({ ok: true, html: "<html>repaired</html>", structuralFingerprintBefore: `sha256:${"a".repeat(64)}`, structuralFingerprintAfter: `sha256:${"a".repeat(64)}` }));
  return {
    buildInventory: vi.fn(() => ({ schemaVersion: "skeleton-inventory/1.0" as const, templateId: "fixture", availableTokens: [], styleHooks: [], assetSlots: [], structuralFingerprint: `sha256:${"a".repeat(64)}` })),
    render, critic, generatePlan, applyPlan,
  };
}

describe("closed-loop repair", () => {
  it("keeps healthy candidates after one critic and no repair", async () => {
    const d = deps(KEEP);
    const result = await runClosedLoopVisualRepair(INPUT, d);
    expect(result.html).toBe(INPUT.html); expect(result.metadata).toBe(INPUT.metadata);
    expect(d.critic).toHaveBeenCalledTimes(1); expect(d.generatePlan).not.toHaveBeenCalled();
  });

  it.each([
    ["nonrepairable", NONREPAIRABLE],
    ["critic fallback", criticFailure],
  ])("keeps the original for %s", async (_name, first) => {
    const d = deps(first);
    const result = await runClosedLoopVisualRepair(INPUT, d);
    expect(result.html).toBe(INPUT.html); expect(result.metadata).toBe(INPUT.metadata);
  });

  it.each(["plan", "apply", "render", "finalCritic"])("keeps the original when %s fails", async (stage) => {
    const d = deps();
    if (stage === "plan") d.generatePlan.mockResolvedValueOnce({ ok: false, kind: "provider_error", promptVersion: "visual-repair-prompt/1.1", durationMs: 1 });
    if (stage === "apply") d.applyPlan.mockResolvedValueOnce({ ok: false, code: "compile_failed" });
    if (stage === "render") d.render.mockResolvedValueOnce(images).mockResolvedValueOnce(null);
    if (stage === "finalCritic") d.critic.mockReset().mockResolvedValueOnce(criticSuccess(BEFORE) as never).mockResolvedValueOnce(criticFailure);
    const result = await runClosedLoopVisualRepair(INPUT, d);
    expect(result.html).toBe(INPUT.html); expect(result.metadata).toBe(INPUT.metadata);
  });

  it("accepts one proven improvement and never exceeds two critics or one plan", async () => {
    const d = deps();
    const result = await runClosedLoopVisualRepair(INPUT, d);
    expect(result).toMatchObject({ html: "<html>repaired</html>", accepted: true, trace: { criticVersion: "visual-quality-verdict/2.1" } });
    expect(d.critic).toHaveBeenCalledTimes(2); expect(d.generatePlan).toHaveBeenCalledTimes(1); expect(d.applyPlan).toHaveBeenCalledTimes(1);
    expect(d.critic).toHaveBeenNthCalledWith(1, expect.objectContaining({ direction: INPUT.direction }), expect.anything());
    expect(d.critic).toHaveBeenNthCalledWith(2, expect.objectContaining({ direction: INPUT.direction }), expect.anything());
  });

  it("carries replacement asset metadata only on an accepted final improvement", async () => {
    const d = deps();
    d.applyPlan.mockResolvedValueOnce({
      ok: true, html: "<html>repaired</html>",
      structuralFingerprintBefore: `sha256:${"a".repeat(64)}`,
      structuralFingerprintAfter: `sha256:${"a".repeat(64)}`,
      assetManifest: ASSET_MANIFEST, assetTrace: ASSET_TRACE,
    });
    const accepted = await runClosedLoopVisualRepair({
      ...INPUT, assetContext: { mode: "curated", projectId: "project-1" },
    }, d);
    expect(d.applyPlan).toHaveBeenCalledWith(expect.objectContaining({
      intent: INPUT.intent,
      assetContext: { mode: "curated", projectId: "project-1" },
    }), expect.anything());
    expect(accepted).toMatchObject({ accepted: true, metadata: { assetManifest: ASSET_MANIFEST, assetTrace: ASSET_TRACE } });

    const rejectedDeps = deps(BEFORE, BEFORE);
    rejectedDeps.applyPlan.mockResolvedValueOnce({
      ok: true, html: "<html>repaired</html>", structuralFingerprintBefore: `sha256:${"a".repeat(64)}`,
      structuralFingerprintAfter: `sha256:${"a".repeat(64)}`, assetManifest: ASSET_MANIFEST, assetTrace: ASSET_TRACE,
    });
    const rejected = await runClosedLoopVisualRepair(INPUT, rejectedDeps);
    expect(rejected.metadata).toBe(INPUT.metadata);
  });

  it("propagates the production shadow trace sink to the repair applier", async () => {
    const sink = vi.fn();
    const d = deps();
    await runClosedLoopVisualRepair({ ...INPUT, assetTraceSink: sink }, d);
    expect(d.applyPlan).toHaveBeenCalledWith(expect.objectContaining({ assetTraceSink: sink }), expect.anything());
  });

  it("retains paid asset telemetry exactly once when final 2C acceptance rejects the applied candidate", async () => {
    const sink = vi.fn();
    const d = deps(BEFORE, BEFORE);
    d.applyPlan.mockImplementation((request) => applyVisualRepairPlan(request, {
      buildInventory: () => ({ schemaVersion: "skeleton-inventory/1.0", templateId: "fixture", availableTokens: [], styleHooks: [], assetSlots: [], structuralFingerprint: `sha256:${"a".repeat(64)}` }),
      compileIdentity: (input) => ({ ok: true, html: input.html.replace("</html>", '<style data-openlen-visual-engine="creative-direction/1.0"></style></html>'), tokens: {}, mode: "light", enforcedConstraints: [] }),
      buildAssetIntents: () => [{ slotIndex: 0 }] as never,
      resolveDomainAssets: async () => ({ ok: true, manifest: ASSET_MANIFEST, trace: ASSET_TRACE }),
      applyAssetManifest: (input) => ({ ok: true, html: input.html, manifest: ASSET_MANIFEST }),
      sanitize: (html) => ({ html }),
      fingerprint: () => `sha256:${"a".repeat(64)}`,
      technicalRender: async () => true,
    }));

    const result = await runClosedLoopVisualRepair({
      ...INPUT,
      assetContext: { mode: "hybrid", projectId: "project-1" },
      assetTraceSink: sink,
    }, d);

    expect(result).toMatchObject({ accepted: false, trace: { resultCode: "not_improved" } });
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith(ASSET_TRACE);
    expect(JSON.stringify(sink.mock.calls)).not.toMatch(/html|prompt(?!Sha256)|raw|private/i);
    expect(result.metadata).toBe(INPUT.metadata);
  });

  it("passes the validated mobile_overflow issue to the bounded apply boundary", async () => {
    const mobileBefore = VisualQualityVerdictSchema.parse({
      ...BEFORE,
      scores: { ...BEFORE.scores, mobileReadability: 4 },
      issues: [{ code: "mobile_overflow", severity: "critical", hookId: null, explanation: "The mobile render visibly overflows its viewport." }],
    });
    const mobileAfter = VisualQualityVerdictSchema.parse({
      ...AFTER,
      scores: { ...AFTER.scores, mobileReadability: 7 },
    });
    const d = deps(mobileBefore, mobileAfter);
    await runClosedLoopVisualRepair(INPUT, d);
    expect(d.applyPlan).toHaveBeenCalledWith(
      expect.objectContaining({ issueCodes: ["mobile_overflow"] }),
      expect.anything(),
    );
  });

  it("turns measured mobile overflow into a bounded repair when the critic says keep", async () => {
    const finalKeep = VisualQualityVerdictSchema.parse({
      ...KEEP,
      scores: { ...KEEP.scores, mobileReadability: 9 },
    });
    const d = deps(KEEP, finalKeep);
    d.render
      .mockResolvedValueOnce({ ...images, mobileOverflow: true })
      .mockResolvedValueOnce({ ...images, mobileOverflow: false });

    const result = await runClosedLoopVisualRepair(INPUT, d);

    expect(result).toMatchObject({ accepted: true, html: "<html>repaired</html>" });
    expect(d.generatePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        verdict: expect.objectContaining({
          decision: "repair",
          issues: [expect.objectContaining({ code: "mobile_overflow", severity: "critical", hookId: null })],
        }),
      }),
      expect.anything(),
    );
    expect(d.applyPlan).toHaveBeenCalledWith(
      expect.objectContaining({ issueCodes: ["mobile_overflow"] }),
      expect.anything(),
    );
  });

  it("rejects a candidate whose final mobile render still overflows", async () => {
    const d = deps(KEEP, KEEP);
    d.render
      .mockResolvedValueOnce({ ...images, mobileOverflow: true })
      .mockResolvedValueOnce({ ...images, mobileOverflow: true });

    const result = await runClosedLoopVisualRepair(INPUT, d);

    expect(result).toMatchObject({ accepted: false, html: INPUT.html, trace: { resultCode: "not_improved" } });
  });

  it("does not replace a coherent nonrepairable verdict with a geometry repair", async () => {
    const d = deps(NONREPAIRABLE);
    d.render.mockResolvedValueOnce({ ...images, mobileOverflow: true });

    const result = await runClosedLoopVisualRepair(INPUT, d);

    expect(result).toMatchObject({ accepted: false, trace: { resultCode: "nonrepairable" } });
    expect(d.generatePlan).not.toHaveBeenCalled();
  });

  it.each([
    ["weak typography", { weakTypographyHierarchy: true }, "weak_typography_hierarchy"],
    ["square components", { squareComponentTreatment: true }, "component_treatment_mismatch"],
  ] as const)("turns measured %s into a bounded repair", async (_name, diagnostic, issueCode) => {
    const finalKeep = VisualQualityVerdictSchema.parse({
      ...KEEP,
      scores: { ...KEEP.scores, visualHierarchy: 9, componentCoherence: 9 },
    });
    const d = deps(KEEP, finalKeep);
    d.render
      .mockResolvedValueOnce({ ...images, ...diagnostic })
      .mockResolvedValueOnce({ ...images, weakTypographyHierarchy: false, squareComponentTreatment: false });

    const result = await runClosedLoopVisualRepair(INPUT, d);

    expect(result).toMatchObject({ accepted: true, html: "<html>repaired</html>" });
    expect(d.generatePlan).toHaveBeenCalledWith(
      expect.objectContaining({ verdict: expect.objectContaining({
        decision: "repair",
        issues: [expect.objectContaining({ code: issueCode, severity: "critical", hookId: null })],
      }) }),
      expect.anything(),
    );
    expect(d.applyPlan).toHaveBeenCalledWith(
      expect.objectContaining({ issueCodes: [issueCode] }),
      expect.anything(),
    );
  });

  it.each([
    ["weak typography", { weakTypographyHierarchy: true }],
    ["square components", { squareComponentTreatment: true }],
  ] as const)("rejects a candidate when measured %s persists", async (_name, diagnostic) => {
    const d = deps(KEEP, KEEP);
    d.render
      .mockResolvedValueOnce({ ...images, ...diagnostic })
      .mockResolvedValueOnce({ ...images, ...diagnostic });

    const result = await runClosedLoopVisualRepair(INPUT, d);

    expect(result).toMatchObject({ accepted: false, html: INPUT.html, trace: { resultCode: "not_improved" } });
  });

  it("does not treat square components as a mismatch when the direction requests square geometry", async () => {
    const d = deps(KEEP);
    d.render.mockResolvedValueOnce({ ...images, squareComponentTreatment: true });

    const result = await runClosedLoopVisualRepair({
      ...INPUT,
      direction: CreativeDirectionSchema.parse({ ...COLORING_DIRECTION, geometry: { ...COLORING_DIRECTION.geometry, radius: "square" } }),
    }, d);

    expect(result).toMatchObject({ accepted: false, trace: { resultCode: "healthy_keep" } });
    expect(d.generatePlan).not.toHaveBeenCalled();
  });

  it("aborts the upstream boundary at the overall deadline and returns the original", async () => {
    let signal: AbortSignal | undefined;
    const d = deps();
    d.render.mockImplementation(async (_html, options) => {
      signal = options?.signal;
      await new Promise(() => undefined);
      return null;
    });
    const result = await runClosedLoopVisualRepair({ ...INPUT, timeoutMs: 5 }, d);
    expect(result.html).toBe(INPUT.html); expect(result.metadata).toBe(INPUT.metadata);
    expect(result.trace.resultCode).toBe("timeout");
    expect(signal?.aborted).toBe(true);
  });

  it("preserves only scalar usage from the two critics and one repair call", async () => {
    const d = deps();
    d.critic.mockReset()
      .mockResolvedValueOnce({ ...criticSuccess(BEFORE), usage: { inputTokens: 10, outputTokens: 2, cachedTokens: 1, thinkingTokens: 3 } } as never)
      .mockResolvedValueOnce({ ...criticSuccess(AFTER), usage: { inputTokens: 11, outputTokens: 3, cachedTokens: 0, thinkingTokens: 2 } } as never);
    d.generatePlan.mockResolvedValueOnce({ ok: true, plan: { schemaVersion: "skeleton-adaptation-plan/1.0", tokens: {}, cssOverride: [], assets: [] }, usage: { inputTokens: 7, outputTokens: 4, cachedTokens: 0, thinkingTokens: 1 }, promptVersion: "visual-repair-prompt/1.1", durationMs: 1 });
    const result = await runClosedLoopVisualRepair(INPUT, d);
    expect(result.trace.usage).toEqual([
      { inputTokens: 10, outputTokens: 2, cachedTokens: 1, thinkingTokens: 3 },
      { inputTokens: 7, outputTokens: 4, cachedTokens: 0, thinkingTokens: 1 },
      { inputTokens: 11, outputTokens: 3, cachedTokens: 0, thinkingTokens: 2 },
    ]);
    expect(JSON.stringify(result.trace)).not.toMatch(/html|explanation|dataBase64/i);
  });

  it.each([
    ["theme_mismatch", "themeRecognition"],
    ["palette_mismatch", "themeRecognition"],
    ["weak_typography_hierarchy", "visualHierarchy"],
    ["spacing_density", "componentCoherence"],
    ["mobile_overflow", "mobileReadability"],
    ["imagery_mismatch", "imageryRelevance"],
    ["component_treatment_mismatch", "componentCoherence"],
  ] as const)("accepts targeted %s improvement", (code, dimension) => {
    const baseScores: VisualQualityScores = { themeRecognition: 7, visualHierarchy: 7, componentCoherence: 7, mobileReadability: 7, imageryRelevance: 7, briefAdherence: 7 };
    const beforeScores = { ...baseScores, [dimension]: 5 };
    const before = VisualQualityVerdictSchema.parse({ schemaVersion: "visual-quality-verdict/2.1", decision: "repair", nonrepairableReason: "none", scores: beforeScores, issues: [{ code, severity: "critical", hookId: null, explanation: "The visible treatment needs repair." }] });
    const after = VisualQualityVerdictSchema.parse({ schemaVersion: "visual-quality-verdict/2.1", decision: "keep", nonrepairableReason: "none", scores: baseScores, issues: [] });
    expect(repairImprovesQuality(before, after)).toBe(true);
  });

  it("allows one-point unrelated score jitter when the targeted defect improves", () => {
    const before = { ...BEFORE, scores: { ...BEFORE.scores, visualHierarchy: 8 } };
    const after = { ...AFTER, scores: { ...AFTER.scores, visualHierarchy: 7 } };
    expect(repairImprovesQuality(before, after)).toBe(true);
  });

  it("rejects relevant regressions, new issues, remaining critical issues, large unrelated drops, and negative total change", () => {
    expect(repairImprovesQuality(BEFORE, { ...AFTER, scores: { ...AFTER.scores, themeRecognition: 4 } })).toBe(false);
    expect(repairImprovesQuality(BEFORE, { ...AFTER, decision: "repair", issues: [{ code: "component_treatment_mismatch", severity: "warning", hookId: null, explanation: "Components remain inconsistent." }] })).toBe(false);
    expect(repairImprovesQuality(BEFORE, { ...AFTER, decision: "repair", issues: [{ code: "palette_mismatch", severity: "critical", hookId: null, explanation: "Palette still misses the intended mood." }] })).toBe(false);
    expect(repairImprovesQuality(BEFORE, { ...AFTER, scores: { ...AFTER.scores, visualHierarchy: 5 } })).toBe(false);
    const highBefore = { ...BEFORE, scores: { ...BEFORE.scores, briefAdherence: 7, visualHierarchy: 8, componentCoherence: 8, mobileReadability: 8, imageryRelevance: 8 } };
    const globallyWorse = { ...AFTER, scores: { ...AFTER.scores, themeRecognition: 7, briefAdherence: 7, visualHierarchy: 7, componentCoherence: 7, mobileReadability: 7, imageryRelevance: 7 } };
    expect(repairImprovesQuality(highBefore, globallyWorse)).toBe(false);
  });

  it("keeps repair eligibility limited to repair verdicts with issues", () => {
    expect(shouldAttemptVisualRepair(BEFORE)).toBe(true);
    expect(shouldAttemptVisualRepair({ ...AFTER, decision: "repair", issues: [{ code: "component_treatment_mismatch", severity: "warning", hookId: null, explanation: "Component treatment conflicts with the approved creative direction." }] })).toBe(true);
    expect(shouldAttemptVisualRepair(KEEP)).toBe(false);
    expect(shouldAttemptVisualRepair(NONREPAIRABLE)).toBe(false);
  });
});
