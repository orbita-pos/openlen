import { captureException as reportException } from "@inariwatch/capture";

import type { BusinessProfileData } from "@/lib/business-profiles/types";
import type {
  ComposeSectionCandidateDeps,
  ComposeSectionCandidateInput,
  SectionCompositionResult,
} from "@/lib/generation/compose-sections";
import {
  SectionCompositionManifestSchema,
  type SectionCompositionManifest,
  type SectionCompositionResultCode,
} from "@/lib/generation/section-composition-contracts";
import { sha256 } from "@/lib/generation/content-hash";
import { TAXONOMY_COMPATIBILITY_VERSION } from "@/lib/generation/taxonomy-compatibility";
import {
  completeVisualEnginePilotRun,
  reserveVisualEnginePilotRun,
  type CompleteVisualEnginePilotRunOutcome,
  type PilotReasonCode,
} from "@/lib/generation/visual-engine-pilot-store";
import type { VisualEngineProjectMetadata } from "@/lib/projects/types";
import type { AssetPipelineMode } from "@/lib/generation/asset-pipeline-mode";
import type { AssetResolutionTrace } from "@/lib/generation/asset-contracts";
import type { SectionRecord } from "@/lib/sections/store";
import type { ExtractedBusinessData } from "@/lib/style-match/autofill/types";
import { finalizeComposedDocument } from "./finalize-composed-document";
import type { FableVisualRepairHandoff } from "./fable-final-visual-gate";
import { runFableAdaptivePipeline, type FableAdaptivePipelineDeps } from "./fable-adaptive-pipeline";
import type { FableRuntimeComposition } from "./fable-runtime-composition";

export interface SectionCompositionCandidateInput {
  allowGeneratedFallback?: boolean;
  projectId?: string;
  assetMode?: AssetPipelineMode;
  assetTraceSink?: (trace: AssetResolutionTrace) => void;
  candidateTitle: string;
  copy: ExtractedBusinessData;
  profileData: BusinessProfileData;
  intent: ComposeSectionCandidateInput["intent"];
  intentHash: string;
  records: readonly SectionRecord[];
  policyVersion: string;
  onStage?: (stage: string) => void;
  /** Private per-request root; never stored in project data. */
  fableRuntime?: FableRuntimeComposition;
}

interface DeliveryData {
  filled: boolean;
  appliedOps: number;
  usage?: { inputTokens: number; outputTokens: number };
  durationMs: number;
  leaksBefore?: number;
  leaksAfter?: number;
  generatedSectionCount?: number;
  generatedSectionUsage?: { inputTokens: number; outputTokens: number; thinkingTokens: number; cachedTokens: number };
}

export type QuickSectionCompositionResult =
  | ({
      ok: true;
      route: "section_composition";
      templateId: null;
      html: string;
      visualEngine: Extract<VisualEngineProjectMetadata, { route: "section_composition" }>;
      /** Private, non-serializable input for Task 5's one-repair state machine. */
      fableVisualRepairHandoff?: FableVisualRepairHandoff;
    } & DeliveryData)
  | {
      ok: false;
      route: "section_composition";
      reasonCode: Exclude<SectionCompositionResultCode, "composed">;
      manifest?: SectionCompositionManifest;
    };

export interface RunSectionCompositionCandidateDeps {
  composeSectionCandidate?: (
    input: ComposeSectionCandidateInput,
    deps?: ComposeSectionCandidateDeps,
  ) => Promise<SectionCompositionResult>;
  finalizeComposedDocument?: typeof finalizeComposedDocument;
  generateMissing?: NonNullable<ComposeSectionCandidateDeps["generateMissing"]>;
  runFableAdaptivePipeline?: typeof runFableAdaptivePipeline;
  fableAdaptivePipelineDeps?: Omit<FableAdaptivePipelineDeps, "runtime" | "finalize">;
}

function composeInput(input: SectionCompositionCandidateInput): ComposeSectionCandidateInput {
  return {
    route: "section_composition",
    ...(input.projectId && input.assetMode ? { projectId: input.projectId, assetMode: input.assetMode } : {}),
    ...(input.assetTraceSink ? { assetTraceSink: input.assetTraceSink } : {}),
    intent: input.intent,
    intentHash: input.intentHash,
    records: input.records,
    copy: input.copy,
    brand: { accent: input.profileData.brand?.accent ?? null },
    onStage: input.onStage,
  };
}

export async function runSectionCompositionCandidate(
  input: SectionCompositionCandidateInput,
  deps: RunSectionCompositionCandidateDeps = {},
): Promise<QuickSectionCompositionResult> {
  const finalize = deps.finalizeComposedDocument ?? finalizeComposedDocument;
  try {
    if (!deps.composeSectionCandidate) {
      if (!input.fableRuntime) return { ok: false, route: "section_composition", reasonCode: "internal_error" };
      return await (deps.runFableAdaptivePipeline ?? runFableAdaptivePipeline)(input, {
        runtime: input.fableRuntime,
        finalize,
        ...(deps.fableAdaptivePipelineDeps ?? {}),
      });
    }
    const compose = deps.composeSectionCandidate;
    // Create-with-AI no longer reaches Gemini's text/vision path. The Fable
    // adaptive composer supplies GLM programs explicitly; this legacy helper
    // only honors an injected repository-owned generator in tests/shadow work.
    const generateMissing = deps.generateMissing;
    const candidate = generateMissing
      ? await compose(composeInput(input), { generateMissing })
      : await compose(composeInput(input));
    if (!candidate.ok) {
      return {
        ok: false,
        route: "section_composition",
        reasonCode: candidate.reasonCode,
        manifest: candidate.manifest,
      };
    }
    const finalized = finalize({
      html: candidate.html,
      profileData: input.profileData,
      title: input.candidateTitle,
    });
    if (!finalized.ok) {
      return { ok: false, route: "section_composition", reasonCode: "sanitization_failed" };
    }
    const compositionManifest = SectionCompositionManifestSchema.parse({
      ...candidate.manifest,
      outputHash: sha256(finalized.html),
      resultCode: "composed",
    });
    const visualEngineBase = {
      schemaVersion: "visual-engine-project/1.0" as const,
      route: "section_composition" as const,
      templateId: null,
      creativeDirection: candidate.creativeDirection,
      promptVersion: candidate.adaptation.promptVersion,
      policyVersion: input.policyVersion,
      contractVersion: "creative-direction/1.0" as const,
      compositionManifest,
    };
    const visualEngine: Extract<VisualEngineProjectMetadata, { route: "section_composition" }> = candidate.adaptation.assetManifest && candidate.adaptation.assetTrace
      ? { ...visualEngineBase, assetManifest: candidate.adaptation.assetManifest, assetTrace: candidate.adaptation.assetTrace }
      : visualEngineBase;
    return {
      ok: true,
      route: "section_composition",
      templateId: null,
      html: finalized.html,
      ...candidate.fill,
      ...(candidate.generatedSectionCount ? { generatedSectionCount: candidate.generatedSectionCount } : {}),
      ...(candidate.generatedSectionUsage ? { generatedSectionUsage: candidate.generatedSectionUsage } : {}),
      visualEngine,
    };
  } catch {
    return { ok: false, route: "section_composition", reasonCode: "internal_error" };
  }
}

export interface ShadowSectionCompositionCandidateInput extends SectionCompositionCandidateInput {
  mode: "shadow";
}

type CaptureException = (
  error: Error,
  context: { route: string; stage: string; templateId: string; reasonCode: PilotReasonCode },
) => void;

export interface ShadowSectionCompositionCandidateDeps extends RunSectionCompositionCandidateDeps {
  reserveVisualEnginePilotRun?: typeof reserveVisualEnginePilotRun;
  completeVisualEnginePilotRun?: typeof completeVisualEnginePilotRun;
  captureException?: CaptureException;
}

function pilotReason(reason: string): PilotReasonCode {
  return reason === "route_ineligible" ? "internal_error" : reason as PilotReasonCode;
}

function compositionOutcome(
  result: SectionCompositionResult,
  policyVersion: string,
): CompleteVisualEnginePilotRunOutcome {
  if (!result.ok) {
    return {
      status: "fallback",
      reasonCode: pilotReason(result.reasonCode),
      promptVersion: result.telemetry?.promptVersion ?? undefined,
      contractVersion: "creative-direction/1.0",
      policyVersion,
      taxonomyVersion: TAXONOMY_COMPATIBILITY_VERSION,
      modelVersion: result.telemetry?.modelId ?? undefined,
      inputTokens: result.telemetry?.usage?.inputTokens,
      outputTokens: result.telemetry?.usage?.outputTokens,
      thinkingTokens: result.telemetry?.usage?.thinkingTokens,
      cachedTokens: result.telemetry?.usage?.cachedTokens,
      durationMs: result.telemetry?.durationMs,
      candidatePersisted: false,
      ...(result.reasonCode === "section_role_coverage_failed" ? { structuralInvariantPassed: false } : {}),
    };
  }
  return {
    status: "adapted",
    promptVersion: result.adaptation.promptVersion,
    contractVersion: "creative-direction/1.0",
    policyVersion,
    taxonomyVersion: TAXONOMY_COMPATIBILITY_VERSION,
    modelVersion: result.adaptation.modelId,
    inputTokens: result.adaptation.usage.inputTokens + (result.fill.usage?.inputTokens ?? 0),
    outputTokens: result.adaptation.usage.outputTokens + (result.fill.usage?.outputTokens ?? 0),
    thinkingTokens: result.adaptation.usage.thinkingTokens,
    cachedTokens: result.adaptation.usage.cachedTokens,
    durationMs: result.adaptation.durationMs + result.fill.durationMs,
    structuralFingerprintBefore: result.adaptation.structuralFingerprintBefore,
    structuralFingerprintAfter: result.adaptation.structuralFingerprintAfter,
    structuralInvariantPassed: true,
    candidatePersisted: false,
  };
}

export async function launchShadowSectionCompositionCandidate(
  input: ShadowSectionCompositionCandidateInput | null,
  deps: ShadowSectionCompositionCandidateDeps = {},
): Promise<SectionCompositionResult | null> {
  if (input === null) return null;
  // Shadow work is explicitly opt-in and injected. Keeping the legacy
  // composer out of this module's import graph prevents Create with AI from
  // regaining Gemini text/vision reachability through a non-default branch.
  const compose = deps.composeSectionCandidate;
  if (!compose) return null;
  const reserve = deps.reserveVisualEnginePilotRun ?? reserveVisualEnginePilotRun;
  const complete = deps.completeVisualEnginePilotRun ?? completeVisualEnginePilotRun;
  const capture = deps.captureException ?? reportException;
  let reservationId: string | null = null;
  let completionAttempted = false;
  const attemptCompletion = async (outcome: CompleteVisualEnginePilotRunOutcome) => {
    if (reservationId === null || completionAttempted) return;
    completionAttempted = true;
    await complete(reservationId, outcome);
  };

  try {
    const result = await compose(composeInput(input), {
      beforeCreative: async () => {
        if (reservationId !== null) return true;
        const reservation = await reserve({
          phase: "2b",
          mode: "shadow",
          route: "section_composition",
          templateId: "section-composition",
        });
        if (!reservation.ok) return false;
        reservationId = reservation.id;
        return true;
      },
    });
    if (reservationId === null) return result;
    await attemptCompletion(compositionOutcome(result, input.policyVersion));
    return result;
  } catch {
    await attemptCompletion({
      status: "failed",
      reasonCode: "internal_error",
      candidatePersisted: false,
    }).catch(() => undefined);
    capture(new Error("Visual Engine shadow composition failed"), {
      route: "curate",
      stage: "visual-engine-shadow-composition",
      templateId: "section-composition",
      reasonCode: "internal_error",
    });
    return null;
  }
}
