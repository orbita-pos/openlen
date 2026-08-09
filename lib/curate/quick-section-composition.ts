import { captureException as reportException } from "@inariwatch/capture";

import type { BusinessProfileData } from "@/lib/business-profiles/types";
import {
  composeSectionCandidate,
  type ComposeSectionCandidateDeps,
  type ComposeSectionCandidateInput,
  type SectionCompositionResult,
} from "@/lib/generation/compose-sections";
import { TAXONOMY_COMPATIBILITY_VERSION } from "@/lib/generation/taxonomy-compatibility";
import {
  completeVisualEnginePilotRun,
  reserveVisualEnginePilotRun,
  type CompleteVisualEnginePilotRunOutcome,
  type PilotReasonCode,
} from "@/lib/generation/visual-engine-pilot-store";
import type { VisualEngineProjectMetadata } from "@/lib/projects/types";
import type { SectionRecord } from "@/lib/sections/store";
import type { ExtractedBusinessData } from "@/lib/style-match/autofill/types";
import {
  fillAndNormalizeCuratedTemplate,
  finalizeCuratedDocument,
  type FillAndNormalizeCuratedTemplateInput,
  type FillAndNormalizeCuratedTemplateResult,
  type FinalizeCuratedDocumentInput,
  type FinalizeCuratedDocumentResult,
} from "./build-curated-document";

export interface SectionCompositionCandidateInput {
  fallbackTemplateId: string;
  fallbackTitle: string;
  candidateTitle: string;
  copy: ExtractedBusinessData;
  profileData: BusinessProfileData;
  intent: ComposeSectionCandidateInput["intent"];
  intentHash: string;
  records: readonly SectionRecord[];
  policyVersion: string;
  onStage?: (stage: string) => void;
}

interface DeliveryData {
  filled: boolean;
  appliedOps: number;
  usage?: { inputTokens: number; outputTokens: number };
  durationMs: number;
  leaksBefore?: number;
  leaksAfter?: number;
}

export type QuickSectionCompositionResult =
  | ({
      ok: true;
      route: "section_composition";
      templateId: "section-composition";
      html: string;
      visualEngine: Extract<VisualEngineProjectMetadata, { route: "section_composition" }>;
    } & DeliveryData)
  | ({
      ok: true;
      route: "fallback";
      templateId: string;
      html: string;
      fallbackReasonCode: string;
    } & DeliveryData)
  | { ok: false; kind: "template-unavailable" | "editor-marker-leak"; templateId: string };

export interface RunSectionCompositionCandidateDeps {
  composeSectionCandidate?: (
    input: ComposeSectionCandidateInput,
    deps?: ComposeSectionCandidateDeps,
  ) => Promise<SectionCompositionResult>;
  fillAndNormalizeCuratedTemplate?: (
    input: FillAndNormalizeCuratedTemplateInput,
  ) => Promise<FillAndNormalizeCuratedTemplateResult>;
  finalizeCuratedDocument?: (input: FinalizeCuratedDocumentInput) => FinalizeCuratedDocumentResult;
}

function buildData(build: Extract<FillAndNormalizeCuratedTemplateResult, { ok: true }>): DeliveryData {
  return {
    filled: build.filled,
    appliedOps: build.appliedOps,
    ...(build.usage ? { usage: build.usage } : {}),
    durationMs: build.durationMs,
    ...(build.leaksBefore === undefined ? {} : { leaksBefore: build.leaksBefore }),
    ...(build.leaksAfter === undefined ? {} : { leaksAfter: build.leaksAfter }),
  };
}

async function weightedFallback(
  input: SectionCompositionCandidateInput,
  reasonCode: string,
  deps: Required<Pick<RunSectionCompositionCandidateDeps, "fillAndNormalizeCuratedTemplate" | "finalizeCuratedDocument">>,
): Promise<QuickSectionCompositionResult> {
  const built = await deps.fillAndNormalizeCuratedTemplate({
    templateId: input.fallbackTemplateId,
    copy: input.copy,
    onStage: input.onStage,
  });
  if (!built.ok) return built;
  const finalized = deps.finalizeCuratedDocument({
    normalizedHtml: built.normalizedHtml,
    profileData: input.profileData,
    title: input.fallbackTitle,
    brandRecolor: true,
  });
  if (!finalized.ok) return { ok: false, kind: finalized.kind, templateId: input.fallbackTemplateId };
  return {
    ok: true,
    route: "fallback",
    templateId: input.fallbackTemplateId,
    html: finalized.html,
    fallbackReasonCode: reasonCode,
    ...buildData(built),
  };
}

function composeInput(input: SectionCompositionCandidateInput): ComposeSectionCandidateInput {
  return {
    route: "section_composition",
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
  const compose = deps.composeSectionCandidate ?? composeSectionCandidate;
  const fill = deps.fillAndNormalizeCuratedTemplate ?? fillAndNormalizeCuratedTemplate;
  const finalize = deps.finalizeCuratedDocument ?? finalizeCuratedDocument;
  const fallbackDeps = { fillAndNormalizeCuratedTemplate: fill, finalizeCuratedDocument: finalize };
  try {
    const candidate = await compose(composeInput(input));
    if (!candidate.ok) return weightedFallback(input, candidate.reasonCode, fallbackDeps);
    const finalized = finalize({
      normalizedHtml: candidate.html,
      profileData: input.profileData,
      title: input.candidateTitle,
      brandRecolor: false,
    });
    if (!finalized.ok) return weightedFallback(input, "sanitization_failed", fallbackDeps);
    return {
      ok: true,
      route: "section_composition",
      templateId: "section-composition",
      html: finalized.html,
      ...candidate.fill,
      visualEngine: {
        schemaVersion: "visual-engine-project/1.0",
        route: "section_composition",
        templateId: null,
        creativeDirection: candidate.creativeDirection,
        promptVersion: candidate.adaptation.promptVersion,
        policyVersion: input.policyVersion,
        contractVersion: "creative-direction/1.0",
        compositionManifest: candidate.manifest,
      },
    };
  } catch {
    return weightedFallback(input, "internal_error", fallbackDeps);
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
  const compose = deps.composeSectionCandidate ?? composeSectionCandidate;
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
