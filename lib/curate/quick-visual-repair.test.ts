import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { AssetManifest, AssetResolutionTrace } from "@/lib/generation/asset-contracts";
import { CreativeDirectionSchema } from "@/lib/generation/creative-contracts";
import { IntentAnalysisSchema } from "@/lib/generation/contracts";
import { COLORING_DIRECTION, COLORING_INTENT } from "@/lib/generation/creative-fixtures.test-support";
import { canonicalJsonSha256, sha256 } from "@/lib/generation/visual-engine-2a-eval";
import { SectionCompositionManifestSchema } from "@/lib/generation/section-composition-contracts";
import { launchShadowVisualRepair, runQuickVisualQualityGate, runQuickVisualRepair } from "./quick-visual-repair";

const direction = CreativeDirectionSchema.parse(COLORING_DIRECTION);
const intent = IntentAnalysisSchema.parse(COLORING_INTENT);
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function assetPair(styleLock: string): { manifest: AssetManifest; trace: AssetResolutionTrace } {
  const unsigned = {
    schemaVersion: "asset-manifest/1.0" as const,
    consistencyGroup: { id: `asset-pack-${styleLock}`, mediaType: "illustration" as const, artDirection: "storybook", paletteHints: [], styleLock },
    slots: [],
    fallbackPolicy: "fail_closed_on_required_identity_asset" as const,
  };
  const manifest = { ...unsigned, manifestId: `sha256:${createHash("sha256").update(canonicalJson(unsigned)).digest("hex")}` as const };
  const trace: AssetResolutionTrace = {
    schemaVersion: "asset-resolution-trace/1.0", manifestId: manifest.manifestId,
    consistencyGroupCount: 1, curatedCount: 0, generatedCount: 0, abstractCount: 0,
    placeholderCount: 0, requiredUnresolvedCount: 0, rejectionCounts: {}, provider: null,
    modelId: null, promptSha256: [], estimatedCostMicromxn: 0, durationMs: 1, resultCode: "resolved",
  };
  return { manifest, trace };
}
const originalPair = assetPair("original");
const replacementPair = assetPair("replacement");
const originalManifest = originalPair.manifest;
const replacementManifest = replacementPair.manifest;
const replacementTrace = replacementPair.trace;
const visualEngine = {
  schemaVersion: "visual-engine-project/1.0" as const, route: "template_skeleton" as const, templateId: "fixture",
  creativeDirection: direction, promptVersion: "creative-prompt/1.0", policyVersion: "template-policy/1.0", contractVersion: "creative-direction/1.0" as const,
  structuralFingerprintBefore: `sha256:${"a".repeat(64)}`, structuralFingerprintAfter: `sha256:${"a".repeat(64)}`,
  assetManifest: originalManifest,
  assetTrace: originalPair.trace,
};
const input = { html: "<html>original</html>", visualEngine, intent, brandAccent: null, projectId: "project-1", assetMode: "curated" as const };
const accepted = {
  html: "<html>repaired</html>", metadata: { route: "section_composition", assetManifest: replacementManifest, assetTrace: replacementTrace }, accepted: true as const,
  trace: {
    resultCode: "accepted", promptVersion: "visual-repair-prompt/1.1", criticVersion: "visual-quality-verdict/2.1" as const,
    issueCodesBefore: ["palette_mismatch" as const], issueCodesAfter: [],
    scoresBefore: { themeRecognition: 5, visualHierarchy: 7, componentCoherence: 7, mobileReadability: 8, imageryRelevance: 6, briefAdherence: 5 },
    scoresAfter: { themeRecognition: 7, visualHierarchy: 7, componentCoherence: 7, mobileReadability: 8, imageryRelevance: 7, briefAdherence: 7 },
    outputHashBefore: `sha256:${"b".repeat(64)}`, outputHashAfter: `sha256:${"c".repeat(64)}`, usage: [],
  },
};

const compositionHtml = '<!doctype html><html><head><style data-openlen-visual-engine="creative-direction/1.0"></style></head><body><section data-sec="hero-one" data-openlen-role="hero"></section><section data-sec="gallery-one" data-openlen-role="coloring_gallery"></section><footer data-sec="footer-one" data-openlen-role="footer"></footer></body></html>';
const compositionVisualEngine = {
  schemaVersion: "visual-engine-project/1.0" as const,
  route: "section_composition" as const,
  templateId: null,
  creativeDirection: direction,
  promptVersion: "creative-prompt/1.0",
  policyVersion: "template-policy/1.0",
  contractVersion: "creative-direction/1.0" as const,
  compositionManifest: SectionCompositionManifestSchema.parse({
    schemaVersion: "section-composition-manifest/1.0",
    intentHash: `sha256:${"a".repeat(64)}`,
    creativeDirectionHash: canonicalJsonSha256(direction),
    inventoryHash: `sha256:${"b".repeat(64)}`,
    orderedRoles: ["hero", "coloring_gallery", "footer"],
    selectedSectionIds: ["hero-one", "gallery-one", "footer-one"],
    selectedContentHashes: ["111111111111", "222222222222", "333333333333"],
    compatibilityRuleIds: ["section_component:hero>hero", "section_component:coloring_gallery>gallery", "section_component:footer>footer"],
    outputHash: sha256(compositionHtml),
    resultCode: "composed",
  }),
};
const qualityInput = { html: compositionHtml, visualEngine: compositionVisualEngine, intent, brandAccent: null };

function rejectedQualityResult(resultCode: string) {
  return { html: compositionHtml, metadata: compositionVisualEngine, accepted: false as const, trace: { resultCode, usage: [] } };
}

function acceptedQualityResult(html = `${compositionHtml}\n`) {
  return {
    html,
    metadata: compositionVisualEngine,
    accepted: true as const,
    trace: {
      ...accepted.trace,
      outputHashBefore: sha256(compositionHtml),
      outputHashAfter: sha256(html),
    },
  };
}

describe("quick visual repair", () => {
  it("off returns original references without invoking the loop", async () => {
    const runRepair = vi.fn();
    const result = await runQuickVisualRepair(input, { mode: "off", runRepair });
    expect(result.html).toBe(input.html); expect(result.visualEngine).toBe(visualEngine); expect(runRepair).not.toHaveBeenCalled();
  });

  it("on persists only accepted redacted repair metadata", async () => {
    const result = await runQuickVisualRepair(input, { mode: "on", runRepair: vi.fn().mockResolvedValue(accepted) });
    expect(result.html).toBe(accepted.html);
    expect(result.visualEngine).not.toBe(visualEngine);
    expect(result.visualEngine.repair).toEqual({
      schemaVersion: "visual-repair-metadata/1.0", accepted: true, promptVersion: "visual-repair-prompt/1.1",
      criticVersion: "visual-quality-verdict/2.1", compilerVersion: "creative-direction/1.0",
      issueCodesBefore: ["palette_mismatch"], issueCodesAfter: [], scoresBefore: accepted.trace.scoresBefore,
      scoresAfter: accepted.trace.scoresAfter, outputHashBefore: accepted.trace.outputHashBefore, outputHashAfter: accepted.trace.outputHashAfter,
    });
    expect(result.visualEngine.assetManifest).toEqual(replacementManifest);
    expect(result.visualEngine.assetTrace).toEqual(replacementTrace);
    expect(result.visualEngine.route).toBe("template_skeleton");
    expect(JSON.stringify(result.visualEngine)).not.toMatch(/usage|explanation|dataBase64/i);
  });

  it("on failure preserves original HTML and metadata reference", async () => {
    const result = await runQuickVisualRepair(input, { mode: "on", runRepair: vi.fn().mockResolvedValue({ html: input.html, metadata: visualEngine, accepted: false, trace: { resultCode: "not_improved", usage: [] } }) });
    expect(result.html).toBe(input.html); expect(result.visualEngine).toBe(visualEngine);
  });

  it("preserves the original asset pair when an accepted repair returns only one replacement field", async () => {
    const oneSided = { ...accepted, metadata: { assetManifest: replacementManifest } };
    const result = await runQuickVisualRepair(input, { mode: "on", runRepair: vi.fn().mockResolvedValue(oneSided) });
    expect(result.html).toBe(oneSided.html);
    expect(result.visualEngine.assetManifest).toBe(originalPair.manifest);
    expect(result.visualEngine.assetTrace).toBe(originalPair.trace);
  });

  it("preserves the original asset pair when both replacement fields fail validation", async () => {
    const invalid = {
      ...accepted,
      metadata: {
        assetManifest: { ...replacementManifest, manifestId: `sha256:${"f".repeat(64)}` },
        assetTrace: { ...replacementTrace, manifestId: `sha256:${"e".repeat(64)}` },
      },
    };
    const result = await runQuickVisualRepair(input, { mode: "on", runRepair: vi.fn().mockResolvedValue(invalid) });
    expect(result.visualEngine.assetManifest).toBe(originalPair.manifest);
    expect(result.visualEngine.assetTrace).toBe(originalPair.trace);
  });

  it("on catches unexpected dependency exceptions and preserves original references", async () => {
    const captureException = vi.fn();
    const result = await runQuickVisualRepair(input, { mode: "on", runRepair: vi.fn().mockRejectedValue(new Error("private")), captureException });
    expect(result.html).toBe(input.html); expect(result.visualEngine).toBe(visualEngine);
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), { route: "curate", stage: "visual-repair-on" });
    expect(JSON.stringify(captureException.mock.calls)).not.toContain("private");
  });

  it("shadow exposes no preview or persistence capability and catches internally", async () => {
    const runRepair = vi.fn().mockRejectedValue(new Error("private"));
    await expect(launchShadowVisualRepair(input, { runRepair, captureException: vi.fn() })).resolves.toBeUndefined();
    expect(runRepair).toHaveBeenCalledTimes(1);
    expect(runRepair.mock.calls[0]).toHaveLength(1);
  });

  it("strict quality accepts only an explicit healthy keep and invokes the loop once even when legacy mode is off", async () => {
    const runRepair = vi.fn().mockResolvedValue(rejectedQualityResult("healthy_keep"));
    const result = await runQuickVisualQualityGate(qualityInput, { mode: "off", runRepair });
    expect(result).toMatchObject({ ok: true, outcome: "healthy_keep", html: compositionHtml });
    expect(runRepair).toHaveBeenCalledTimes(1);
  });

  it("strict quality seals accepted repaired bytes and redacted repair metadata", async () => {
    const repaired = acceptedQualityResult();
    const result = await runQuickVisualQualityGate(qualityInput, { runRepair: vi.fn().mockResolvedValue(repaired) });
    expect(result).toMatchObject({
      ok: true,
      outcome: "repaired",
      html: repaired.html,
      visualEngine: {
        compositionManifest: { outputHash: sha256(repaired.html), resultCode: "composed" },
        repair: { outputHashBefore: sha256(compositionHtml), outputHashAfter: sha256(repaired.html) },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/usage|explanation|dataBase64/i);
  });

  it.each([
    "nonrepairable",
    "timeout",
    "initial_render_failed",
    "initial_critic_failed",
    "repair_provider_failed",
    "final_render_failed",
    "final_critic_failed",
    "not_improved",
    "internal_error",
  ])("strict quality fails closed for %s", async (detailCode) => {
    const result = await runQuickVisualQualityGate(qualityInput, {
      runRepair: vi.fn().mockResolvedValue(rejectedQualityResult(detailCode)),
    });
    expect(result).toEqual({ ok: false, reasonCode: "visual_quality_failed", detailCode });
  });

  it("strict quality rejects a repaired result whose pre-repair hash is not the manifest hash", async () => {
    const repaired = acceptedQualityResult();
    repaired.trace.outputHashBefore = `sha256:${"f".repeat(64)}`;
    await expect(runQuickVisualQualityGate(qualityInput, { runRepair: vi.fn().mockResolvedValue(repaired) })).resolves.toEqual({
      ok: false,
      reasonCode: "visual_quality_failed",
      detailCode: "internal_error",
    });
  });

  it("strict quality rejects a repaired result whose post-repair hash does not match its HTML", async () => {
    const repaired = acceptedQualityResult();
    repaired.trace.outputHashAfter = `sha256:${"f".repeat(64)}`;
    await expect(runQuickVisualQualityGate(qualityInput, { runRepair: vi.fn().mockResolvedValue(repaired) })).resolves.toEqual({
      ok: false,
      reasonCode: "visual_quality_failed",
      detailCode: "internal_error",
    });
  });

  it("strict quality redacts thrown dependency errors", async () => {
    const captureException = vi.fn();
    const result = await runQuickVisualQualityGate(qualityInput, {
      runRepair: vi.fn().mockRejectedValue(new Error("private")),
      captureException,
    });
    expect(result).toEqual({ ok: false, reasonCode: "visual_quality_failed", detailCode: "internal_error" });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), { route: "curate", stage: "visual-quality-gate" });
    expect(JSON.stringify(captureException.mock.calls)).not.toContain("private");
  });
});
