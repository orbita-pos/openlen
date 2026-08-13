import { describe, expect, it, vi } from "vitest";

import type { BusinessProfileData } from "@/lib/business-profiles/types";
import { CreativeDirectionSchema } from "@/lib/generation/creative-contracts";
import { COLORING_DIRECTION, COLORING_INTENT } from "@/lib/generation/creative-fixtures.test-support";
import { IntentAnalysisSchema } from "@/lib/generation/contracts";
import { SectionCompositionManifestSchema } from "@/lib/generation/section-composition-contracts";
import { canonicalJsonSha256, sha256 } from "@/lib/generation/content-hash";
import type { SectionRecord } from "@/lib/sections/store";
import type { ExtractedBusinessData } from "@/lib/style-match/autofill/types";
import {
  AI_HYBRID_POLICY_VERSION,
  type AiCreationReasonCode,
  type AiCreationStage,
} from "./ai-creation-contracts";
import {
  runAiCreation,
  type RunAiCreationDeps,
} from "./run-ai-creation";

const INTENT = IntentAnalysisSchema.parse(COLORING_INTENT);
const DIRECTION = CreativeDirectionSchema.parse(COLORING_DIRECTION);
const HTML = '<!doctype html><html><head><style data-openlen-visual-engine="creative-direction/1.0"></style></head><body><section data-sec="hero-one" data-openlen-role="hero"></section><section data-sec="gallery-one" data-openlen-role="coloring_gallery"></section><footer data-sec="footer-one" data-openlen-role="footer"></footer></body></html>';
const COPY = { business_name: "Invented name", hero_keyword: "Magic" } as ExtractedBusinessData;
const OVERLAID_COPY = { ...COPY, business_name: "Mundo Pincel" };
const COPY_USAGE = { inputTokens: 12, outputTokens: 8, cachedTokens: 2, thinkingTokens: 0 };
const PROFILE = {
  business_name: "Mundo Pincel",
  brand: { accent: "#f06aa6", logoUrl: null },
} as BusinessProfileData;
const INPUT = {
  projectId: "project-1",
  brief: "Actividades magicas para colorear",
  profileData: PROFILE,
  assetMode: "hybrid" as const,
  assetTraceSink: vi.fn(),
  onStage: vi.fn(),
};

const RECORD = {
  id: "hero-one",
  type: "hero",
  name: "Hero",
  variantLabel: "One",
  rootTag: "section",
  mode: "light",
  storageKey: "sections/hero-one-111111111111.html",
  storageUrl: "memory://hero-one",
  contentHash: "111111111111",
  size: 10,
  designTokens: null,
  fonts: null,
  needsJs: false,
  hasPlaceholders: false,
  thumbnailUrl: null,
  status: "published",
  createdAt: new Date(0),
  updatedAt: new Date(0),
  publishedAt: new Date(0),
} as SectionRecord;

const VISUAL_ENGINE = {
  schemaVersion: "visual-engine-project/1.0" as const,
  route: "section_composition" as const,
  templateId: null,
  creativeDirection: DIRECTION,
  promptVersion: "creative-prompt/1.0",
  policyVersion: AI_HYBRID_POLICY_VERSION,
  contractVersion: "creative-direction/1.0" as const,
  compositionManifest: SectionCompositionManifestSchema.parse({
    schemaVersion: "section-composition-manifest/2.0",
    intentHash: canonicalJsonSha256(INTENT),
    creativeDirectionHash: canonicalJsonSha256(DIRECTION),
    inventoryHash: `sha256:${"b".repeat(64)}`,
    orderedRoles: ["hero", "coloring_gallery", "footer"],
    selectedSectionIds: ["hero-one", "gallery-one", "footer-one"],
    selectedContentHashes: ["111111111111", "222222222222", "333333333333"],
    selectedSourceKinds: ["template_derived", "template_derived", "template_derived"],
    selectedSourceTemplateIds: ["arcana", "obra", "lumen"], selectedSourceBandOrdinals: [0, 1, 2],
    selectedStructuralFingerprints: [`sha256:${"1".repeat(64)}`, `sha256:${"2".repeat(64)}`, `sha256:${"3".repeat(64)}`],
    compatibilityRuleIds: [
      "section_component:hero>hero",
      "section_component:coloring_gallery>gallery",
      "section_component:footer>footer",
    ],
    outputHash: sha256(HTML),
    resultCode: "composed",
  }),
};

const INTENT_OK = {
  ok: true as const,
  intent: INTENT,
  modelId: "intent-fixture",
  promptVersion: "intent-prompt/1.8" as const,
  durationMs: 4,
};
const COPY_OK = {
  ok: true as const,
  copy: COPY,
  modelId: "copy-fixture",
  promptVersion: "page-copy-prompt/1.0" as const,
  usage: COPY_USAGE,
  durationMs: 5,
};
const COMPOSITION_OK = {
  ok: true as const,
  route: "section_composition" as const,
  templateId: null,
  html: HTML,
  visualEngine: VISUAL_ENGINE,
  filled: true,
  appliedOps: 7,
  durationMs: 12,
  leaksBefore: 2,
  leaksAfter: 0,
};

function makeDeps(overrides: Partial<RunAiCreationDeps> = {}): Required<RunAiCreationDeps> {
  return {
    analyzeIntent: vi.fn(async () => INTENT_OK),
    generatePageCopy: vi.fn(async () => COPY_OK),
    listSections: vi.fn(async () => [RECORD]),
    overlayProfile: vi.fn(() => OVERLAID_COPY),
    runSectionCompositionCandidate: vi.fn(async () => COMPOSITION_OK),
    validateAiCompositionDelivery: vi.fn(({ visualEngine }) => ({
      ok: true as const,
      visualEngine: visualEngine as typeof VISUAL_ENGINE,
    })),
    runQuickVisualQualityGate: vi.fn(async () => ({
      ok: true as const,
      outcome: "healthy_keep" as const,
      html: HTML,
      visualEngine: VISUAL_ENGINE,
    })),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function expectOnlyPublicFailure(
  result: unknown,
  stage: AiCreationStage,
  reasonCode: AiCreationReasonCode,
) {
  expect(result).toEqual({ ok: false, stage, reasonCode, retryable: true });
  expect(Object.keys(result as object).sort()).toEqual(["ok", "reasonCode", "retryable", "stage"]);
}

function expectProviderBoundariesAtMostOnce(deps: Required<RunAiCreationDeps>) {
  expect(vi.mocked(deps.analyzeIntent).mock.calls.length).toBeLessThanOrEqual(1);
  expect(vi.mocked(deps.generatePageCopy).mock.calls.length).toBeLessThanOrEqual(1);
  expect(vi.mocked(deps.runSectionCompositionCandidate).mock.calls.length).toBeLessThanOrEqual(1);
  expect(vi.mocked(deps.runQuickVisualQualityGate).mock.calls.length).toBeLessThanOrEqual(1);
}

const FAILURE_CASES = [
  {
    name: "sections",
    stage: "sections",
    reasonCode: "section_inventory_unavailable",
    override: () => ({ listSections: vi.fn(async () => { throw new Error("private DB state"); }) }),
    later: ["runSectionCompositionCandidate", "validateAiCompositionDelivery", "runQuickVisualQualityGate"],
  },
  {
    name: "composition",
    stage: "composition",
    reasonCode: "composition_failed",
    override: () => ({ runSectionCompositionCandidate: vi.fn(async () => ({ ok: false as const, route: "section_composition" as const, reasonCode: "internal_error" as const })) }),
    later: ["validateAiCompositionDelivery", "runQuickVisualQualityGate"],
  },
  {
    name: "delivery gate",
    stage: "delivery_gate",
    reasonCode: "semantic_gate_failed",
    override: () => ({ validateAiCompositionDelivery: vi.fn(() => ({ ok: false as const, reasonCode: "invalid_composition_manifest" as const })) }),
    later: ["runQuickVisualQualityGate"],
  },
  {
    name: "visual quality",
    stage: "visual_quality",
    reasonCode: "visual_quality_failed",
    override: () => ({ runQuickVisualQualityGate: vi.fn(async () => ({ ok: false as const, reasonCode: "visual_quality_failed" as const, detailCode: "private-provider-detail" })) }),
    later: [],
  },
] satisfies Array<{
  name: string;
  stage: AiCreationStage;
  reasonCode: AiCreationReasonCode;
  override: () => Partial<RunAiCreationDeps>;
  later: Array<keyof RunAiCreationDeps>;
}>;

describe("runAiCreation", () => {
  it("starts intent and copy before awaiting either provider", async () => {
    const intent = deferred<typeof INTENT_OK>();
    const copy = deferred<typeof COPY_OK>();
    const deps = makeDeps({
      analyzeIntent: vi.fn(() => intent.promise),
      generatePageCopy: vi.fn(() => copy.promise),
    });

    const resultPromise = runAiCreation(INPUT, deps);

    expect(deps.analyzeIntent).toHaveBeenCalledOnce();
    expect(deps.generatePageCopy).toHaveBeenCalledOnce();
    expect(deps.listSections).not.toHaveBeenCalled();
    intent.resolve(INTENT_OK);
    await Promise.resolve();
    expect(deps.listSections).not.toHaveBeenCalled();
    copy.resolve(COPY_OK);

    await expect(resultPromise).resolves.toMatchObject({ ok: true });
  });

  it("delivers only the twice-validated composition and redacted copy usage", async () => {
    const deps = makeDeps();

    const result = await runAiCreation(INPUT, deps);

    expect(deps.overlayProfile).toHaveBeenCalledWith(COPY, PROFILE);
    expect(deps.listSections).toHaveBeenCalledWith({ status: "published" });
    expect(deps.runSectionCompositionCandidate).toHaveBeenCalledWith({
      allowGeneratedFallback: process.env.OPENLEN_AI_CREATION === "enabled",
      projectId: "project-1",
      assetMode: "hybrid",
      assetTraceSink: INPUT.assetTraceSink,
      candidateTitle: "Mundo Pincel",
      copy: OVERLAID_COPY,
      profileData: PROFILE,
      intent: INTENT,
      intentHash: canonicalJsonSha256(INTENT),
      records: [RECORD],
      policyVersion: AI_HYBRID_POLICY_VERSION,
      onStage: INPUT.onStage,
    });
    expect(deps.validateAiCompositionDelivery).toHaveBeenNthCalledWith(1, {
      html: HTML,
      visualEngine: VISUAL_ENGINE,
      leaksAfter: 0,
    });
    expect(deps.runQuickVisualQualityGate).toHaveBeenCalledWith({
      projectId: "project-1",
      assetMode: "hybrid",
      assetTraceSink: INPUT.assetTraceSink,
      html: HTML,
      visualEngine: VISUAL_ENGINE,
      intent: INTENT,
      brandAccent: "#f06aa6",
      explicitConstraints: INTENT.explicitConstraints,
    });
    expect(deps.validateAiCompositionDelivery).toHaveBeenNthCalledWith(2, {
      html: HTML,
      visualEngine: VISUAL_ENGINE,
      leaksAfter: 0,
    });
    expect(result).toEqual({
      ok: true,
      route: "section_composition",
      templateId: null,
      title: "Mundo Pincel",
      html: HTML,
      visualEngine: VISUAL_ENGINE,
      copyUsage: COPY_USAGE,
      filled: true,
      appliedOps: 7,
    });
    expect(result).toMatchObject({
      ok: true,
      route: "section_composition",
      templateId: null,
      visualEngine: {
        route: "section_composition",
        templateId: null,
        policyVersion: "ai-hybrid-policy/1.0",
        compositionManifest: { resultCode: "composed" },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/weighted|template_skeleton|template_full/i);
    expectProviderBoundariesAtMostOnce(deps);
  });

  it("allows generated missing sections only under the enabled AI creation flag", async () => {
    const previous = process.env.OPENLEN_AI_CREATION;
    try {
      process.env.OPENLEN_AI_CREATION = "disabled";
      const disabled = makeDeps();
      await runAiCreation(INPUT, disabled);
      expect(disabled.runSectionCompositionCandidate).toHaveBeenCalledWith(expect.objectContaining({ allowGeneratedFallback: false }));
      process.env.OPENLEN_AI_CREATION = "enabled";
      const enabled = makeDeps();
      await runAiCreation(INPUT, enabled);
      expect(enabled.runSectionCompositionCandidate).toHaveBeenCalledWith(expect.objectContaining({ allowGeneratedFallback: true }));
    } finally {
      if (previous === undefined) delete process.env.OPENLEN_AI_CREATION;
      else process.env.OPENLEN_AI_CREATION = previous;
    }
  });

  it.each(FAILURE_CASES)("fails closed at $name without invoking a later stage", async ({ stage, reasonCode, override, later }) => {
    const deps = makeDeps(override());

    const result = await runAiCreation(INPUT, deps);

    expectOnlyPublicFailure(result, stage, reasonCode);
    expect(JSON.stringify(result)).not.toMatch(/private|provider-detail/i);
    for (const boundary of later) {
      expect(deps[boundary]).not.toHaveBeenCalled();
    }
    expectProviderBoundariesAtMostOnce(deps);
  });

  it("continues deterministically when intent and copy providers fail", async () => {
    const deps = makeDeps({
      analyzeIntent: vi.fn(async () => ({
        ok: false as const,
        error: { kind: "api" as const, message: "private" },
        modelId: "intent-fixture",
        promptVersion: "intent-prompt/1.8" as const,
        durationMs: 4,
      })),
      generatePageCopy: vi.fn(async () => ({
        ok: false as const,
        error: { kind: "provider" as const, message: "private" },
        modelId: "copy-fixture",
        promptVersion: "page-copy-prompt/1.0" as const,
        durationMs: 5,
      })),
    });

    const result = await runAiCreation(INPUT, deps);

    expect(result).toMatchObject({ ok: true, route: "section_composition" });
    expect(deps.runSectionCompositionCandidate).toHaveBeenCalledWith(expect.objectContaining({
      intent: expect.objectContaining({ schemaVersion: "intent-analysis/1.0" }),
      copy: expect.objectContaining({ business_name: expect.any(String) }),
    }));
    expect(deps.analyzeIntent).toHaveBeenCalledOnce();
    expect(deps.generatePageCopy).toHaveBeenCalledOnce();
  });

  it("fails at sections when no authoritative published inventory exists", async () => {
    const deps = makeDeps({ listSections: vi.fn(async () => []) });

    const result = await runAiCreation(INPUT, deps);

    expectOnlyPublicFailure(result, "sections", "section_inventory_unavailable");
    expect(deps.runSectionCompositionCandidate).not.toHaveBeenCalled();
  });

  it.each([
    ["route_ineligible", "composition_failed"],
    ["unsupported_section_role", "section_plan_failed"],
    ["section_inventory_stale", "section_inventory_unavailable"],
    ["section_fragment_unavailable", "section_fragment_unavailable"],
    ["section_fragment_stale", "section_fragment_unavailable"],
    ["section_fragment_invalid", "section_fragment_unavailable"],
    ["section_role_coverage_failed", "section_plan_failed"],
    ["inherited_copy_leak", "inherited_copy_leak"],
    ["provider_timeout", "creative_direction_failed"],
    ["provider_error", "creative_direction_failed"],
    ["budget_exceeded", "creative_direction_failed"],
    ["invalid_provider_response", "creative_direction_failed"],
    ["model_incompatible", "creative_direction_failed"],
    ["css_policy_violation", "creative_direction_failed"],
    ["contrast_violation", "creative_direction_failed"],
    ["required_asset_unavailable", "asset_resolution_failed"],
    ["sanitization_failed", "composition_failed"],
    ["technical_render_failed", "composition_failed"],
    ["internal_error", "composition_failed"],
  ] as const)("maps composition detail %s to stable reason %s", async (detail, expected) => {
    const deps = makeDeps({
      runSectionCompositionCandidate: vi.fn(async () => ({
        ok: false as const,
        route: "section_composition" as const,
        reasonCode: detail,
      })),
    });

    const result = await runAiCreation(INPUT, deps);

    expectOnlyPublicFailure(result, "composition", expected);
    expect(deps.validateAiCompositionDelivery).not.toHaveBeenCalled();
    expect(deps.runQuickVisualQualityGate).not.toHaveBeenCalled();
    expectProviderBoundariesAtMostOnce(deps);
  });

  it("maps inherited copy discovered by the delivery gate without exposing gate detail", async () => {
    const deps = makeDeps({
      runSectionCompositionCandidate: vi.fn(async () => ({ ...COMPOSITION_OK, leaksAfter: 1 })),
      validateAiCompositionDelivery: vi.fn(() => ({ ok: false as const, reasonCode: "section_role_coverage_failed" as const })),
    });

    const result = await runAiCreation(INPUT, deps);

    expectOnlyPublicFailure(result, "delivery_gate", "inherited_copy_leak");
    expect(deps.runQuickVisualQualityGate).not.toHaveBeenCalled();
  });

  it("maps invalid final asset metadata after visual repair to the delivery gate", async () => {
    let validationCalls = 0;
    const validate: Required<RunAiCreationDeps>["validateAiCompositionDelivery"] = vi.fn(({ visualEngine }) => {
      validationCalls += 1;
      return validationCalls === 1
        ? { ok: true as const, visualEngine: visualEngine as typeof VISUAL_ENGINE }
        : { ok: false as const, reasonCode: "asset_metadata_invalid" as const };
    });
    const deps = makeDeps({ validateAiCompositionDelivery: validate });

    const result = await runAiCreation(INPUT, deps);

    expectOnlyPublicFailure(result, "delivery_gate", "asset_resolution_failed");
    expect(vi.mocked(validate)).toHaveBeenCalledTimes(2);
    expect(deps.runQuickVisualQualityGate).toHaveBeenCalledTimes(1);
    expectProviderBoundariesAtMostOnce(deps);
  });

  it("does not retry when provider-capable dependencies reject", async () => {
    const deps = makeDeps({
      runQuickVisualQualityGate: vi.fn(async () => { throw new Error("private critic response"); }),
    });

    const result = await runAiCreation(INPUT, deps);

    expectOnlyPublicFailure(result, "visual_quality", "visual_quality_failed");
    expectProviderBoundariesAtMostOnce(deps);
  });
});
