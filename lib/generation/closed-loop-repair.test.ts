import { describe, expect, it, vi } from "vitest";
import { CreativeDirectionSchema } from "./creative-contracts";
import { IntentAnalysisSchema } from "./contracts";
import { runClosedLoopVisualRepair, repairImprovesQuality, shouldAttemptVisualRepair, type ClosedLoopVisualRepairDeps } from "./closed-loop-repair";
import { COLORING_DIRECTION, COLORING_INTENT } from "./creative-fixtures.test-support";
import { VisualQualityVerdictSchema } from "./visual-repair-contracts";

const scores = { themeRecognition: 5, visualHierarchy: 7, componentCoherence: 7, mobileReadability: 8, imageryRelevance: 6, briefAdherence: 5 };
const BEFORE = VisualQualityVerdictSchema.parse({ schemaVersion: "visual-quality-verdict/2.0", decision: "repair", scores, issues: [{ code: "palette_mismatch", severity: "critical", hookId: null, explanation: "Palette misses the intended mood." }] });
const AFTER = VisualQualityVerdictSchema.parse({ schemaVersion: "visual-quality-verdict/2.0", decision: "keep", scores: { ...scores, themeRecognition: 7, imageryRelevance: 7, briefAdherence: 7 }, issues: [] });
const KEEP = VisualQualityVerdictSchema.parse({ ...AFTER, scores: { ...AFTER.scores, themeRecognition: 9 } });
const INPUT = { html: "<html>original</html>", metadata: { route: "template_skeleton" }, sourceId: "fixture", intent: IntentAnalysisSchema.parse(COLORING_INTENT), direction: CreativeDirectionSchema.parse(COLORING_DIRECTION), route: "template_skeleton" as const };
const images = { desktop: { mimeType: "image/jpeg", dataBase64: "ZA==" }, mobile: { mimeType: "image/jpeg", dataBase64: "bQ==" } };
const criticSuccess = (verdict: unknown) => ({ ok: true as const, verdict, durationMs: 1, promptVersion: "visual-quality-critic/2.3" as const, modelId: "critic-test" });
const criticFailure = { ok: false as const, kind: "provider_error" as const, durationMs: 1, promptVersion: "visual-quality-critic/2.3" as const, modelId: "critic-test" };

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
    ["nonrepairable", VisualQualityVerdictSchema.parse({ ...BEFORE, decision: "nonrepairable" })],
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
    expect(result).toMatchObject({ html: "<html>repaired</html>", accepted: true });
    expect(d.critic).toHaveBeenCalledTimes(2); expect(d.generatePlan).toHaveBeenCalledTimes(1); expect(d.applyPlan).toHaveBeenCalledTimes(1);
    expect(d.critic).toHaveBeenNthCalledWith(1, expect.objectContaining({ direction: INPUT.direction }), expect.anything());
    expect(d.critic).toHaveBeenNthCalledWith(2, expect.objectContaining({ direction: INPUT.direction }), expect.anything());
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

  it("rejects score decreases, gains below two, and remaining critical issues", () => {
    expect(repairImprovesQuality(BEFORE, { ...AFTER, scores: { ...AFTER.scores, visualHierarchy: 6 } })).toBe(false);
    expect(repairImprovesQuality(BEFORE, { ...BEFORE, decision: "keep", scores: { ...BEFORE.scores, themeRecognition: 6 }, issues: [] })).toBe(false);
    expect(repairImprovesQuality(BEFORE, { ...AFTER, issues: [{ code: "palette_mismatch", severity: "critical", hookId: null, explanation: "Palette still misses the intended mood." }] })).toBe(false);
    expect(repairImprovesQuality(BEFORE, AFTER)).toBe(true);
    expect(shouldAttemptVisualRepair(BEFORE)).toBe(true);
    expect(shouldAttemptVisualRepair({ ...AFTER, decision: "repair", issues: [{ code: "component_treatment_mismatch", severity: "warning", hookId: null, explanation: "Component treatment conflicts with the approved creative direction." }] })).toBe(true);
  });
});
