import { describe, expect, it, vi } from "vitest";

import type { CompleteVisualEnginePilotRunOutcome } from "@/lib/generation/visual-engine-pilot-store";
import { CreativeDirectionSchema } from "@/lib/generation/creative-contracts";
import { COLORING_DIRECTION } from "@/lib/generation/creative-fixtures.test-support";
import { IntentAnalysisSchema } from "@/lib/generation/contracts";
import type { SectionCompositionManifest } from "@/lib/generation/section-composition-contracts";
import type { ExtractedBusinessData } from "@/lib/style-match/autofill/types";
import type { BusinessProfileData } from "@/lib/business-profiles/types";
import {
  launchShadowSectionCompositionCandidate,
  runSectionCompositionCandidate,
  type SectionCompositionCandidateInput,
} from "./quick-section-composition";

const DIRECTION = CreativeDirectionSchema.parse(COLORING_DIRECTION);
const INTENT = IntentAnalysisSchema.parse({
  schemaVersion: "intent-analysis/1.0", language: "es",
  functional: { siteType: "content_platform", requiredSections: ["hero", "stories"], primaryActions: ["read"], contentModel: "creative_activities" },
  audience: { primary: "children", ageRange: "age_4_9", secondary: ["parents"] }, domains: ["creative_play"],
  emotionalGoals: ["magical"], requiredVisualSignals: ["storybook"], forbiddenVisualSignals: ["corporate_dashboard"],
  explicitConstraints: [], ambiguities: [], confidence: 0.95,
});
const MANIFEST: SectionCompositionManifest = {
  schemaVersion: "section-composition-manifest/1.0", intentHash: `sha256:${"a".repeat(64)}`,
  creativeDirectionHash: `sha256:${"b".repeat(64)}`, inventoryHash: `sha256:${"c".repeat(64)}`,
  orderedRoles: ["hero", "stories"], selectedSectionIds: ["hero-01", "features-01"],
  selectedContentHashes: ["111111111111", "222222222222"],
  compatibilityRuleIds: ["section_component:exact:hero", "section_component:structural:stories>features"],
  outputHash: `sha256:${"d".repeat(64)}`, resultCode: "composed",
};
const INPUT: SectionCompositionCandidateInput = {
  projectId: "project-1", assetMode: "curated",
  fallbackTemplateId: "weighted", fallbackTitle: "Weighted", candidateTitle: "PintaMundo",
  copy: { business_name: "PintaMundo" } as ExtractedBusinessData,
  profileData: { brand: { accent: "#F06AA6", logoUrl: null } } as BusinessProfileData,
  intent: INTENT, intentHash: `sha256:${"a".repeat(64)}`, records: [], policyVersion: "template-policy/1.0",
};

const COMPOSED = {
  ok: true as const, status: "composed" as const, html: "COMPOSED-COMPLETE", creativeDirection: DIRECTION,
  manifest: MANIFEST,
  fill: { filled: true, appliedOps: 8, usage: { inputTokens: 5, outputTokens: 3 }, durationMs: 12, leaksBefore: 0, leaksAfter: 0 },
  adaptation: {
    ok: true as const, status: "adapted" as const,
    creativeDirectionVersion: "creative-direction/1.0" as const, planVersion: "skeleton-adaptation-plan/1.0" as const,
    promptVersion: "creative-direction/1.7", modelId: "gemini-fixture",
    structuralFingerprintBefore: `sha256:${"e".repeat(64)}`, structuralFingerprintAfter: `sha256:${"e".repeat(64)}`,
    usage: { inputTokens: 20, outputTokens: 10, thinkingTokens: 2, cachedTokens: 0 }, durationMs: 25,
    assetManifest: { schemaVersion: "asset-manifest/1.0", manifestId: `sha256:${"f".repeat(64)}` } as never,
    assetTrace: { schemaVersion: "asset-resolution-trace/1.0", resultCode: "resolved" } as never,
  },
};

function fallbackBuild(templateId: string) {
  return { ok: true as const, templateId, templateHtml: "RAW", normalizedHtml: "WEIGHTED-COMPLETE", filled: true, appliedOps: 2, durationMs: 3 };
}

describe("runSectionCompositionCandidate", () => {
  it("returns only the finalized composition with section metadata", async () => {
    const result = await runSectionCompositionCandidate(INPUT, {
      composeSectionCandidate: async () => COMPOSED,
      finalizeCuratedDocument: ({ normalizedHtml }) => ({ ok: true, html: `${normalizedHtml}|FINAL` }),
      fillAndNormalizeCuratedTemplate: vi.fn(),
    });
    expect(result).toMatchObject({
      ok: true, route: "section_composition", templateId: "section-composition", html: "COMPOSED-COMPLETE|FINAL",
      visualEngine: { route: "section_composition", templateId: null, creativeDirection: DIRECTION, compositionManifest: MANIFEST },
      filled: true, appliedOps: 8,
    });
  });

  it("passes project ID and asset mode into composition and persists accepted asset metadata", async () => {
    const compose = vi.fn(async () => COMPOSED);
    const result = await runSectionCompositionCandidate(INPUT, {
      composeSectionCandidate: compose,
      finalizeCuratedDocument: ({ normalizedHtml }) => ({ ok: true, html: normalizedHtml }),
      fillAndNormalizeCuratedTemplate: vi.fn(),
    });
    expect(compose).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project-1", assetMode: "curated" }));
    expect(result).toMatchObject({ ok: true, route: "section_composition", visualEngine: {
      assetManifest: COMPOSED.adaptation.assetManifest,
      assetTrace: COMPOSED.adaptation.assetTrace,
    } });
  });

  it("rebuilds the weighted fallback atomically on any typed composition failure", async () => {
    const result = await runSectionCompositionCandidate(INPUT, {
      composeSectionCandidate: async () => ({ ok: false, status: "fallback", reasonCode: "section_fragment_stale", manifest: { ...MANIFEST, outputHash: null, resultCode: "section_fragment_stale" } }),
      fillAndNormalizeCuratedTemplate: async ({ templateId }) => fallbackBuild(templateId),
      finalizeCuratedDocument: ({ normalizedHtml }) => ({ ok: true, html: `${normalizedHtml}|FINAL` }),
    });
    expect(result).toMatchObject({ ok: true, route: "fallback", templateId: "weighted", html: "WEIGHTED-COMPLETE|FINAL", fallbackReasonCode: "section_fragment_stale" });
    expect(JSON.stringify(result)).not.toContain("COMPOSED-COMPLETE");
  });
});

describe("launchShadowSectionCompositionCandidate", () => {
  it("reserves phase 2b immediately before creative work and completes exactly once without persistence", async () => {
    const order: string[] = [];
    const complete = vi.fn(async (_id: string, _outcome: CompleteVisualEnginePilotRunOutcome) => undefined);
    await launchShadowSectionCompositionCandidate({ ...INPUT, mode: "shadow" }, {
      reserveVisualEnginePilotRun: async (row) => { order.push(`reserve:${row.phase}:${row.route}`); return { ok: true, id: "run-2b", ordinal: 1 }; },
      composeSectionCandidate: async (_input, deps = {}) => {
        await deps.beforeCreative?.();
        order.push("creative");
        return COMPOSED;
      },
      completeVisualEnginePilotRun: complete,
      captureException: vi.fn(),
    });
    expect(order).toEqual(["reserve:2b:section_composition", "creative"]);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith("run-2b", expect.objectContaining({
      status: "adapted", candidatePersisted: false, inputTokens: 25, outputTokens: 13, durationMs: 37,
    }));
  });
});
