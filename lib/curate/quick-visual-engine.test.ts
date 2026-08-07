import { describe, expect, it, vi } from "vitest";

import { IntentAnalysisSchema, type GenerationDecision } from "@/lib/generation/contracts";
import { CreativeDirectionSchema } from "@/lib/generation/creative-contracts";
import type { SafeSelectionResult } from "@/lib/generation/safe-selection";
import type { TemplateVisualMetadata } from "@/lib/templates/visual-metadata";
import type { BusinessProfileData } from "@/lib/business-profiles/types";
import type { ExtractedBusinessData } from "@/lib/style-match/autofill/types";
import {
  calculateQuickDeliveryCredits,
  commitQuickVisualEngineDocument,
  launchShadowSkeletonCandidate,
  planQuickVisualEngineRoute,
  runSkeletonCandidate,
} from "./quick-visual-engine";

const INTENT = IntentAnalysisSchema.parse({
  schemaVersion: "intent-analysis/1.0",
  language: "es",
  functional: { siteType: "coloring_platform", requiredSections: ["gallery"], primaryActions: ["color"], contentModel: "activities" },
  audience: { primary: "children", ageRange: "age_4_9", secondary: ["parents"] },
  domains: ["creative_play"],
  emotionalGoals: ["playful"],
  requiredVisualSignals: ["coloring_art"],
  forbiddenVisualSignals: ["corporate_dashboard"],
  explicitConstraints: [], ambiguities: [], confidence: 0.96,
});
const DIRECTION = CreativeDirectionSchema.parse({
  schemaVersion: "creative-direction/1.0",
  mode: "cream",
  visualArchetype: "creative_play",
  emotionalTone: ["playful"],
  palette: { background: "#FFF7FC", surface: "#FFFFFF", surfaceAlt: "#FCE7F3", foreground: "#31213A", foregroundMuted: "#6B5B73", accent: "#EC4899", accentInk: "#FFFFFF", border: "#F5B8D3" },
  typography: { display: "rounded_playful", body: "friendly_high_legibility", mono: null, scale: "expressive" },
  geometry: { radius: "extra_round", radiusScale: 1.75, spacingScale: 1.15, density: "low_medium" },
  imagery: { strategy: "illustration_first", artDirection: "storybook", subjects: ["crayons"], avoid: ["corporate"] },
  iconography: { style: "rounded_filled", strokeWeight: "medium", cornerStyle: "round" },
  componentTreatment: { cards: "soft", buttons: "round", navigation: "friendly", sections: "pastel" },
  requiredVisualSignals: ["coloring_art"], forbiddenVisualSignals: ["corporate_dashboard"],
});
const COPY = { business_name: "Mundo Color" } as ExtractedBusinessData;
const PROFILE = { brand: { accent: "#EC4899", logoUrl: null } } as BusinessProfileData;
const METADATA = {
  schemaVersion: "template-visual-metadata/1.0",
  reviewStatus: "reviewed",
  supportedSiteTypes: ["coloring_platform"],
  domains: ["creative_play"],
  audiences: ["children"],
  ageRanges: ["age_4_9"],
  emotionalRegisters: ["playful"],
  visualArchetypes: ["creative_play"],
  layoutTraits: ["card_grid"],
  requiredAssetTypes: ["illustration"],
  supportedSectionRoles: ["gallery"],
  visualSignals: ["coloring_art"],
  negativeTags: ["corporate_dashboard"],
  themeability: "high",
  identityStrength: "high",
} as TemplateVisualMetadata;

function decision(route: GenerationDecision["route"], templateId: string | null): GenerationDecision {
  return {
    schemaVersion: "generation-decision/1.0", route, templateId,
    structuralFit: 0.9, identityFit: 0.5, adaptationCost: 0.2,
    selectedSections: [], rejectedCandidates: [],
  };
}

function safe(route: GenerationDecision["route"], templateId: string | null): SafeSelectionResult {
  return {
    ok: true, intent: INTENT, decision: decision(route, templateId), ranked: [],
    promptVersion: "intent-prompt/1.5", policyVersion: "template-policy/1.0",
    modelId: "safe-model", durationMs: 5,
  };
}

const SAFE_ERROR: SafeSelectionResult = { ok: false, errorKind: "timeout", durationMs: 5 };

describe("planQuickVisualEngineRoute", () => {
  it.each([
    { mode: "off", safeResult: safe("template_skeleton", "safe-skeleton"), kind: "weighted", id: "weighted", shadow: null },
    { mode: "shadow", safeResult: safe("template_skeleton", "safe-skeleton"), kind: "weighted", id: "weighted", shadow: "safe-skeleton" },
    { mode: "shadow", safeResult: safe("template_full", "safe-full"), kind: "weighted", id: "weighted", shadow: null },
    { mode: "shadow", safeResult: SAFE_ERROR, kind: "weighted", id: "weighted", shadow: null },
    { mode: "skeleton", safeResult: safe("template_full", "safe-full"), kind: "template_full", id: "safe-full", shadow: null },
    { mode: "skeleton", safeResult: safe("template_skeleton", "safe-skeleton"), kind: "template_skeleton", id: "safe-skeleton", shadow: null },
    { mode: "skeleton", safeResult: safe("section_composition", null), kind: "weighted", id: "weighted", shadow: null },
    { mode: "skeleton", safeResult: safe("safe_failure", null), kind: "weighted", id: "weighted", shadow: null },
    { mode: "skeleton", safeResult: SAFE_ERROR, kind: "weighted", id: "weighted", shadow: null },
  ] as const)("maps $mode / $kind without crossing route identities", ({ mode, safeResult, kind, id, shadow }) => {
    expect(planQuickVisualEngineRoute({ mode, weightedTemplateId: "weighted", safeResult })).toEqual({
      delivery: { kind, templateId: id }, shadowTemplateId: shadow,
    });
  });
});

function buildResult(templateId: string, html = `${templateId}-normalized`) {
  return {
    ok: true as const,
    templateId,
    templateHtml: `${templateId}-raw`,
    normalizedHtml: html,
    filled: true,
    appliedOps: 2,
    usage: { inputTokens: 4, outputTokens: 2 },
    durationMs: 10,
    leaksBefore: 0,
    leaksAfter: 0,
  };
}

function candidateInput() {
  return {
    candidateTemplateId: "safe-skeleton",
    fallbackTemplateId: "weighted",
    candidateTitle: "Safe",
    fallbackTitle: "Weighted",
    copy: COPY,
    profileData: PROFILE,
    intent: INTENT,
    templateMetadata: METADATA,
    policyVersion: "template-policy/1.0",
  } as const;
}

const ADAPTED = {
  ok: true as const,
  status: "adapted" as const,
  html: "safe-adapted",
  creativeDirectionVersion: "creative-direction/1.0" as const,
  planVersion: "skeleton-adaptation-plan/1.0" as const,
  creativeDirection: DIRECTION,
  promptVersion: "creative-prompt/1.0",
  modelId: "creative-model",
  structuralFingerprintBefore: `sha256:${"a".repeat(64)}`,
  structuralFingerprintAfter: `sha256:${"a".repeat(64)}`,
  usage: { inputTokens: 20, outputTokens: 10, thinkingTokens: 5, cachedTokens: 0 },
  durationMs: 25,
};

describe("runSkeletonCandidate", () => {
  it("returns only the finalized adapted document and versioned metadata", async () => {
    const build = vi.fn(async ({ templateId }: { templateId: string }) => buildResult(templateId));
    const finalize = vi.fn(({ normalizedHtml, brandRecolor }: { normalizedHtml: string; brandRecolor: boolean }) => ({ ok: true as const, html: `${normalizedHtml}|final:${brandRecolor}` }));

    const result = await runSkeletonCandidate(candidateInput(), {
      fillAndNormalizeCuratedTemplate: build,
      adaptTemplateSkeleton: vi.fn(async () => ADAPTED),
      finalizeCuratedDocument: finalize,
    });

    expect(result).toMatchObject({
      ok: true, route: "template_skeleton", templateId: "safe-skeleton",
      html: "safe-adapted|final:false",
      visualEngine: {
        schemaVersion: "visual-engine-project/1.0", route: "template_skeleton",
        templateId: "safe-skeleton", creativeDirection: DIRECTION,
        promptVersion: "creative-prompt/1.0", policyVersion: "template-policy/1.0",
        contractVersion: "creative-direction/1.0",
        structuralFingerprintBefore: `sha256:${"a".repeat(64)}`,
        structuralFingerprintAfter: `sha256:${"a".repeat(64)}`,
      },
    });
    expect(build).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledWith(expect.objectContaining({ brandRecolor: false }));
  });

  it("falls back atomically to the original weighted ID and never exposes the unadapted skeleton", async () => {
    const result = await runSkeletonCandidate(candidateInput(), {
      fillAndNormalizeCuratedTemplate: async ({ templateId }) => buildResult(templateId),
      adaptTemplateSkeleton: async () => ({
        ok: false, status: "fallback", reasonCode: "contrast_violation",
        promptVersion: "creative-prompt/1.0", modelId: "creative-model", usage: null, durationMs: 20,
      }),
      finalizeCuratedDocument: ({ normalizedHtml, brandRecolor }) => ({ ok: true, html: `${normalizedHtml}|final:${brandRecolor}` }),
    });

    expect(result).toMatchObject({
      ok: true, route: "fallback", templateId: "weighted",
      html: "weighted-normalized|final:true", fallbackReasonCode: "contrast_violation",
    });
    expect(result).not.toHaveProperty("visualEngine");
    expect(JSON.stringify(result)).not.toContain("safe-skeleton-raw");
    expect(JSON.stringify(result)).not.toContain("safe-skeleton-normalized");
  });

  it("emits one final skeleton preview before persistence with matching metadata", async () => {
    const result = await runSkeletonCandidate(candidateInput(), {
      fillAndNormalizeCuratedTemplate: async ({ templateId }) => buildResult(templateId),
      adaptTemplateSkeleton: async () => ADAPTED,
      finalizeCuratedDocument: ({ normalizedHtml }) => ({ ok: true, html: `${normalizedHtml}|final` }),
    });
    if (!result.ok) throw new Error("fixture run failed");
    if (result.route !== "template_skeleton") throw new Error("fixture did not adapt");
    const order: string[] = [];
    let persisted: unknown;

    await commitQuickVisualEngineDocument(result, {
      emitPreview: (html) => order.push(`preview:${html}`),
      persist: async (data) => { order.push("persist"); persisted = data; },
    });

    expect(order).toEqual(["preview:safe-adapted|final", "persist"]);
    expect(persisted).toEqual({ html: "safe-adapted|final", generation: { visualEngine: result.visualEngine } });
  });

  it("persists and emits only the complete fallback document after adaptation failure", async () => {
    const result = await runSkeletonCandidate(candidateInput(), {
      fillAndNormalizeCuratedTemplate: async ({ templateId }) => buildResult(templateId),
      adaptTemplateSkeleton: async () => ({ ok: false, status: "fallback", reasonCode: "provider_timeout", promptVersion: null, modelId: null, usage: null, durationMs: 15 }),
      finalizeCuratedDocument: ({ normalizedHtml }) => ({ ok: true, html: `${normalizedHtml}|complete` }),
    });
    if (!result.ok) throw new Error("fixture run failed");
    const previews: string[] = [];
    const persisted: unknown[] = [];
    await commitQuickVisualEngineDocument(result, { emitPreview: (html) => previews.push(html), persist: async (data) => { persisted.push(data); } });

    expect(previews).toEqual(["weighted-normalized|complete"]);
    expect(persisted).toEqual([{ html: "weighted-normalized|complete" }]);
  });
});

describe("Quick credit invariants", () => {
  it("charges only the existing picker and fill costs for an adapted delivery", () => {
    const usageCredits = vi.fn(() => 3);
    expect(calculateQuickDeliveryCredits({
      pickUsage: { inputTokens: 100, outputTokens: 20 },
      filled: true,
    }, usageCredits, 2)).toBe(5);
    expect(usageCredits).toHaveBeenCalledOnce();
  });
});

describe("shadow skeleton candidate", () => {
  it("does nothing without a shadow input, so off cannot call creative or pilot code", async () => {
    const reserve = vi.fn();
    const adapt = vi.fn();
    await launchShadowSkeletonCandidate(null, {
      reserveVisualEnginePilotRun: reserve,
      adaptTemplateSkeleton: adapt,
    });
    expect(reserve).not.toHaveBeenCalled();
    expect(adapt).not.toHaveBeenCalled();
  });

  it("keeps the baseline as the only emitted/persisted project while completing redacted shadow telemetry", async () => {
    const events: string[] = [];
    const projects: unknown[] = [];
    await commitQuickVisualEngineDocument(
      { html: "weighted-final" },
      { emitPreview: (html) => events.push(html), persist: async (data) => { projects.push(data); } },
    );
    const complete = vi.fn(async () => undefined);

    await launchShadowSkeletonCandidate({
      ...candidateInput(), mode: "shadow",
    }, {
      fillAndNormalizeCuratedTemplate: async ({ templateId }) => buildResult(templateId),
      reserveVisualEnginePilotRun: async () => ({ ok: true, id: "run-1", ordinal: 1 }),
      adaptTemplateSkeleton: async () => ADAPTED,
      finalizeCuratedDocument: ({ normalizedHtml }) => ({ ok: true, html: `${normalizedHtml}|final` }),
      completeVisualEnginePilotRun: complete,
      captureException: vi.fn(),
    });

    expect(events).toEqual(["weighted-final"]);
    expect(projects).toEqual([{ html: "weighted-final" }]);
    expect(complete).toHaveBeenCalledWith("run-1", expect.objectContaining({ status: "adapted", candidatePersisted: false }));
  });

  it("reserves immediately before adaptation and no-ops when quota is exhausted", async () => {
    const order: string[] = [];
    const adapt = vi.fn(async () => { order.push("adapt"); return ADAPTED; });
    const complete = vi.fn();
    await launchShadowSkeletonCandidate({ ...candidateInput(), mode: "shadow" }, {
      fillAndNormalizeCuratedTemplate: async ({ templateId }) => { order.push("build"); return buildResult(templateId); },
      reserveVisualEnginePilotRun: async () => { order.push("reserve"); return { ok: false, code: "pilot_quota_exhausted" }; },
      adaptTemplateSkeleton: adapt,
      completeVisualEnginePilotRun: complete,
    });
    expect(order).toEqual(["build", "reserve"]);
    expect(adapt).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it("completes every reserved typed fallback without persisting a candidate", async () => {
    const complete = vi.fn(async () => undefined);
    await launchShadowSkeletonCandidate({ ...candidateInput(), mode: "shadow" }, {
      fillAndNormalizeCuratedTemplate: async ({ templateId }) => buildResult(templateId),
      reserveVisualEnginePilotRun: async () => ({ ok: true, id: "run-fallback", ordinal: 3 }),
      adaptTemplateSkeleton: async () => ({
        ok: false,
        status: "fallback",
        reasonCode: "contrast_violation",
        promptVersion: "creative-prompt/1.0",
        modelId: "creative-model",
        usage: { inputTokens: 20, outputTokens: 10, thinkingTokens: 5, cachedTokens: 0 },
        durationMs: 25,
      }),
      completeVisualEnginePilotRun: complete,
    });

    expect(complete).toHaveBeenCalledWith("run-fallback", expect.objectContaining({
      status: "fallback",
      reasonCode: "contrast_violation",
      candidatePersisted: false,
      inputTokens: 20,
      outputTokens: 10,
    }));
  });

  it.each([
    { name: "adapted", adaptation: ADAPTED },
    {
      name: "fallback",
      adaptation: {
        ok: false as const,
        status: "fallback" as const,
        reasonCode: "contrast_violation" as const,
        promptVersion: "creative-prompt/1.0",
        modelId: "creative-model",
        usage: { inputTokens: 20, outputTokens: 10, thinkingTokens: 5, cachedTokens: 0 },
        durationMs: 25,
      },
    },
  ])("never issues a second terminal completion when $name completion throws", async ({ adaptation }) => {
    const complete = vi.fn(async () => { throw new Error("database completion failed"); });
    const capture = vi.fn();

    await launchShadowSkeletonCandidate({ ...candidateInput(), mode: "shadow" }, {
      fillAndNormalizeCuratedTemplate: async ({ templateId }) => buildResult(templateId),
      reserveVisualEnginePilotRun: async () => ({ ok: true, id: "run-terminal", ordinal: 4 }),
      adaptTemplateSkeleton: async () => adaptation,
      finalizeCuratedDocument: ({ normalizedHtml }) => ({ ok: true, html: `${normalizedHtml}|final` }),
      completeVisualEnginePilotRun: complete,
      captureException: capture,
    });

    expect(complete).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Visual Engine shadow candidate failed" }),
      { route: "curate", stage: "visual-engine-shadow", templateId: "safe-skeleton", reasonCode: "internal_error" },
    );
  });

  it("completes reserved exceptions with a typed reason and captures only redacted context", async () => {
    const capture = vi.fn();
    const complete = vi.fn(async () => undefined);
    await launchShadowSkeletonCandidate({ ...candidateInput(), mode: "shadow" }, {
      fillAndNormalizeCuratedTemplate: async ({ templateId }) => buildResult(templateId),
      reserveVisualEnginePilotRun: async () => ({ ok: true, id: "run-2", ordinal: 2 }),
      adaptTemplateSkeleton: async () => { throw new Error("secret provider response and user brief"); },
      completeVisualEnginePilotRun: complete,
      captureException: capture,
    });

    expect(complete).toHaveBeenCalledWith("run-2", {
      status: "failed", reasonCode: "internal_error", candidatePersisted: false,
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Visual Engine shadow candidate failed" }),
      { route: "curate", stage: "visual-engine-shadow", templateId: "safe-skeleton", reasonCode: "internal_error" },
    );
    expect(JSON.stringify(capture.mock.calls)).not.toContain("secret provider response");
    expect(JSON.stringify(capture.mock.calls)).not.toContain("Mundo Color");
  });
});
