import { describe, expect, it, vi } from "vitest";
import type { AssetResolutionTrace } from "./asset-contracts";
import { CreativeDirectionSchema, SkeletonAdaptationPlanSchema } from "./creative-contracts";
import { applyVisualRepairPlan } from "./apply-visual-repair";
import { COLORING_DIRECTION, COLORING_INTENT } from "./creative-fixtures.test-support";
import { IntentAnalysisSchema } from "./contracts";
import { VISUAL_ENGINE_2C_CASES } from "./visual-engine-2c-cohort";
import { buildVisualEngine2CDirection, buildVisualEngine2CFixtureHtml } from "./visual-engine-2c-fixtures";

const HTML = '<!doctype html><html><head></head><body><header data-openlen-role="header"></header><main><section data-openlen-role="hero"></section></main><footer data-openlen-role="footer"></footer></body></html>';
const PLAN = SkeletonAdaptationPlanSchema.parse({ schemaVersion: "skeleton-adaptation-plan/1.0", tokens: {}, cssOverride: [], assets: [] });
const HASH = `sha256:${"a".repeat(64)}`;
const INVENTORY = { schemaVersion: "skeleton-inventory/1.0" as const, templateId: "fixture", availableTokens: [], styleHooks: [], assetSlots: [], structuralFingerprint: HASH };
const ASSET_MANIFEST = { schemaVersion: "asset-manifest/1.0", manifestId: `sha256:${"f".repeat(64)}` } as never;
const ASSET_TRACE: AssetResolutionTrace = {
  schemaVersion: "asset-resolution-trace/1.0", manifestId: `sha256:${"f".repeat(64)}`,
  consistencyGroupCount: 1, curatedCount: 0, generatedCount: 1, abstractCount: 0,
  placeholderCount: 0, requiredUnresolvedCount: 0, rejectionCounts: {}, provider: "gemini",
  modelId: "gemini-image-test", promptSha256: [`sha256:${"b".repeat(64)}`],
  usage: { inputTokens: 31, outputTokens: 7, cachedTokens: 3, thinkingTokens: 2 },
  estimatedCostMicromxn: 456, durationMs: 19, resultCode: "resolved",
};

describe("applyVisualRepairPlan", () => {
  it("returns replacement asset metadata only after curated manifest application succeeds", async () => {
    const order: string[] = [];
    const assetTraceSink = vi.fn();
    const result = await applyVisualRepairPlan({
      html: HTML,
      sourceId: "fixture",
      intent: IntentAnalysisSchema.parse(COLORING_INTENT),
      direction: CreativeDirectionSchema.parse(COLORING_DIRECTION),
      plan: PLAN,
      assetContext: { mode: "curated", projectId: "project-1" },
      assetTraceSink,
    }, {
      buildInventory: () => INVENTORY,
      compileIdentity: (input) => ({ ok: true, html: input.html.replace("</head>", '<style data-openlen-visual-engine="creative-direction/1.0"></style></head>'), tokens: {}, mode: "light", enforcedConstraints: [] }),
      buildAssetIntents: () => { order.push("intent"); return [{ slotIndex: 0 }] as never; },
      resolveDomainAssets: async (input) => { order.push(`${input.mode}:${input.projectId}`); return { ok: true, manifest: ASSET_MANIFEST, trace: ASSET_TRACE }; },
      applyAssetManifest: (input) => { order.push("apply"); return { ok: true, html: input.html, manifest: ASSET_MANIFEST }; },
      sanitize: (html) => ({ html }), fingerprint: () => HASH, technicalRender: async () => true,
    });
    expect(result).toMatchObject({ ok: true, assetManifest: ASSET_MANIFEST, assetTrace: ASSET_TRACE });
    expect(assetTraceSink).toHaveBeenCalledTimes(1);
    expect(assetTraceSink).toHaveBeenCalledWith(ASSET_TRACE);
    expect(order).toEqual(["intent", "curated:project-1", "apply"]);
  });
  it("runs inventory, compiler, assets, sanitizer, fingerprint, roles and render atomically", async () => {
    const order: string[] = [];
    const result = await applyVisualRepairPlan({ html: HTML, sourceId: "fixture", direction: CreativeDirectionSchema.parse(COLORING_DIRECTION), plan: PLAN }, {
      buildInventory: () => { order.push("inventory"); return INVENTORY; },
      compileIdentity: (input) => { order.push("compile"); expect(input.inventory).toBe(INVENTORY); return { ok: true, html: input.html.replace("</head>", '<style data-openlen-visual-engine="creative-direction/1.0"></style></head>'), tokens: {}, mode: "light", enforcedConstraints: [] }; },
      resolveAssets: async (input) => { order.push("assets"); return { ok: true, html: input.html, applied: 0, assigned: [] }; },
      sanitize: (html) => { order.push("sanitize"); return { html }; },
      fingerprint: () => { order.push("fingerprint"); return HASH; },
      technicalRender: async () => { order.push("render"); return true; },
    });
    expect(result).toMatchObject({ ok: true, structuralFingerprintBefore: HASH, structuralFingerprintAfter: HASH });
    expect(result.ok && result.html).not.toBe(HTML);
    expect(order).toEqual(["inventory", "compile", "assets", "sanitize", "fingerprint", "render"]);
  });

  it.each(["sanitize", "render"] as const)("emits the paid asset trace once when repair %s rejects before 2C acceptance", async (stage) => {
    const assetTraceSink = vi.fn();
    const result = await applyVisualRepairPlan({
      html: HTML,
      sourceId: "fixture",
      intent: IntentAnalysisSchema.parse(COLORING_INTENT),
      direction: CreativeDirectionSchema.parse(COLORING_DIRECTION),
      plan: PLAN,
      assetContext: { mode: "hybrid", projectId: "project-1" },
      assetTraceSink,
    }, {
      buildInventory: () => INVENTORY,
      compileIdentity: (input) => ({ ok: true, html: input.html.replace("</head>", '<style data-openlen-visual-engine="creative-direction/1.0"></style></head>'), tokens: {}, mode: "light", enforcedConstraints: [] }),
      buildAssetIntents: () => [{ slotIndex: 0 }] as never,
      resolveDomainAssets: async () => ({ ok: true, manifest: ASSET_MANIFEST, trace: ASSET_TRACE }),
      applyAssetManifest: (input) => ({ ok: true, html: input.html, manifest: ASSET_MANIFEST }),
      sanitize: (html) => ({ html: stage === "sanitize" ? null : html }),
      fingerprint: () => HASH,
      technicalRender: async () => stage !== "render",
    });

    expect(result).toMatchObject({ ok: false, code: stage === "sanitize" ? "sanitization_failed" : "technical_render_failed" });
    expect(assetTraceSink).toHaveBeenCalledTimes(1);
    expect(assetTraceSink).toHaveBeenCalledWith(ASSET_TRACE);
    expect(JSON.stringify(assetTraceSink.mock.calls)).not.toMatch(/html|prompt(?!Sha256)|raw|private/i);
    expect(result).not.toHaveProperty("assetManifest");
    expect(result).not.toHaveProperty("assetTrace");
  });

  it.each(["compile", "assets", "sanitize", "fingerprint", "render"])("returns no candidate on %s failure", async (stage) => {
    const result = await applyVisualRepairPlan({ html: HTML, sourceId: "fixture", direction: CreativeDirectionSchema.parse(COLORING_DIRECTION), plan: PLAN }, {
      buildInventory: () => INVENTORY,
      compileIdentity: () => stage === "compile" ? { ok: false, code: "invalid_input", message: "private" } : { ok: true, html: HTML.replace("</head>", '<style data-openlen-visual-engine="creative-direction/1.0"></style></head>'), tokens: {}, mode: "light", enforcedConstraints: [] },
      resolveAssets: async (input) => stage === "assets" ? { ok: false, code: "required_asset_unavailable", slotIndex: 0 } : { ok: true, html: input.html, applied: 0, assigned: [] },
      sanitize: (html) => ({ html: stage === "sanitize" ? null : html }),
      fingerprint: () => stage === "fingerprint" ? `sha256:${"b".repeat(64)}` : HASH,
      technicalRender: vi.fn(async () => stage !== "render"),
    });
    expect(result).toMatchObject({ ok: false });
    expect(result).not.toHaveProperty("html");
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("adds one fixed mobile containment preset for a validated mobile_overflow issue", async () => {
    const row = VISUAL_ENGINE_2C_CASES[10]!;
    const original = buildVisualEngine2CFixtureHtml(row);
    let rendered = "";
    const result = await applyVisualRepairPlan({
      html: original,
      sourceId: row.fixtureId,
      direction: buildVisualEngine2CDirection(row),
      plan: PLAN,
      issueCodes: ["mobile_overflow"],
    }, {
      technicalRender: async (html) => { rendered = html; return true; },
    });

    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.structuralFingerprintAfter).toBe(result.ok ? result.structuralFingerprintBefore : "");
    expect(rendered).toContain("@media(max-width:700px)");
    expect(rendered).toContain("body>:first-child{width:100%!important;max-width:100%!important");
    expect(rendered).toContain('[data-openlen-role="hero"],[data-openlen-role="features"]{grid-template-columns:minmax(0,1fr)!important');
    expect(rendered.match(/data-openlen-visual-engine=/g)).toHaveLength(1);
  });

  it.each([
    ["another issue", ["palette_mismatch"]],
    ["a case-variant lookalike", ["MOBILE_OVERFLOW"]],
  ])("does not add mobile containment for %s", async (_name, issueCodes) => {
    let compiledForAssets = "";
    const result = await applyVisualRepairPlan({
      html: HTML,
      sourceId: "fixture",
      direction: CreativeDirectionSchema.parse(COLORING_DIRECTION),
      plan: PLAN,
      issueCodes: issueCodes as never,
    }, {
      buildInventory: () => INVENTORY,
      compileIdentity: (input) => ({ ok: true, html: input.html.replace("</head>", '<style data-openlen-visual-engine="creative-direction/1.0"></style></head>'), tokens: {}, mode: "light", enforcedConstraints: [] }),
      resolveAssets: async (input) => { compiledForAssets = input.html; return { ok: true, html: input.html, applied: 0, assigned: [] }; },
      sanitize: (html) => ({ html }),
      fingerprint: () => HASH,
      technicalRender: async () => true,
    });
    expect(result).toMatchObject({ ok: true });
    expect(compiledForAssets).not.toContain("body>:first-child{width:100%!important");
  });
});
