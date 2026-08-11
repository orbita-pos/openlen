import { captureException as reportException } from "@inariwatch/capture";

import type { BusinessProfileData } from "@/lib/business-profiles/types";
import { adaptTemplateSkeleton, type SkeletonAdaptationResult } from "@/lib/generation/adapt-skeleton";
import type { IntentAnalysis } from "@/lib/generation/contracts";
import type { SafeSelectionResult } from "@/lib/generation/safe-selection";
import { TAXONOMY_COMPATIBILITY_VERSION } from "@/lib/generation/taxonomy-compatibility";
import type { VisualEngineMode } from "@/lib/generation/visual-engine-mode";
import type { AssetPipelineMode } from "@/lib/generation/asset-pipeline-mode";
import type { AssetResolutionTrace } from "@/lib/generation/asset-contracts";
import {
  completeVisualEnginePilotRun,
  reserveVisualEnginePilotRun,
  type CompleteVisualEnginePilotRunOutcome,
  type PilotReasonCode,
} from "@/lib/generation/visual-engine-pilot-store";
import type { ProjectData, VisualEngineProjectMetadata } from "@/lib/projects/types";
import type { ExtractedBusinessData } from "@/lib/style-match/autofill/types";
import type { TemplateVisualMetadata } from "@/lib/templates/visual-metadata";
import {
  fillAndNormalizeCuratedTemplate,
  finalizeCuratedDocument,
  type FillAndNormalizeCuratedTemplateInput,
  type FillAndNormalizeCuratedTemplateResult,
  type FinalizeCuratedDocumentInput,
  type FinalizeCuratedDocumentResult,
} from "./build-curated-document";

export type QuickVisualEngineDeliveryKind = "weighted" | "template_full" | "template_skeleton" | "section_composition";

export type QuickVisualEngineShadowCandidate =
  | { kind: "template_skeleton"; templateId: string }
  | { kind: "section_composition" };

export interface QuickVisualEngineRoutePlan {
  delivery:
    | { kind: Exclude<QuickVisualEngineDeliveryKind, "section_composition">; templateId: string }
    | { kind: "section_composition"; templateId: null };
  shadowCandidate: QuickVisualEngineShadowCandidate | null;
}

type UsageCreditCalculator = (
  inputTokens: number,
  outputTokens: number,
  model: "gemini-flash",
) => number;

/** Keeps Visual Engine creative usage outside the existing Quick user debit. */
export function calculateQuickDeliveryCredits(
  input: {
    pickUsage?: { inputTokens: number; outputTokens: number };
    filled: boolean;
  },
  usageCredits: UsageCreditCalculator,
  autofillCreditCost: number,
): number {
  const pickCredits = input.pickUsage
    ? usageCredits(input.pickUsage.inputTokens, input.pickUsage.outputTokens, "gemini-flash")
    : 1;
  return pickCredits + (input.filled ? autofillCreditCost : 0);
}

export function planQuickVisualEngineRoute(input: {
  mode: VisualEngineMode;
  weightedTemplateId: string;
  safeResult: SafeSelectionResult | null;
}): QuickVisualEngineRoutePlan {
  const weighted = {
    delivery: { kind: "weighted" as const, templateId: input.weightedTemplateId },
    shadowCandidate: null,
  };
  if (input.mode === "off" || !input.safeResult?.ok) return weighted;

  const { decision } = input.safeResult;
  if (input.mode === "shadow") {
    if (decision.route === "template_skeleton" && decision.templateId) {
      return { ...weighted, shadowCandidate: { kind: "template_skeleton", templateId: decision.templateId } };
    }
    if (decision.route === "section_composition") {
      return { ...weighted, shadowCandidate: { kind: "section_composition" } };
    }
    return weighted;
  }
  if (
    (decision.route === "template_full" || decision.route === "template_skeleton")
    && decision.templateId
  ) {
    return {
      delivery: { kind: decision.route, templateId: decision.templateId },
      shadowCandidate: null,
    };
  }
  if (input.mode === "composition" && decision.route === "section_composition") {
    return {
      delivery: { kind: "section_composition", templateId: null },
      shadowCandidate: null,
    };
  }
  return weighted;
}

export interface SkeletonCandidateInput {
  projectId?: string;
  assetMode?: AssetPipelineMode;
  assetTraceSink?: (trace: AssetResolutionTrace) => void;
  candidateTemplateId: string;
  fallbackTemplateId: string;
  candidateTitle: string;
  fallbackTitle: string;
  copy: ExtractedBusinessData;
  profileData: BusinessProfileData;
  intent: IntentAnalysis;
  templateMetadata: TemplateVisualMetadata;
  policyVersion: string;
  onStage?: (stage: string) => void;
}

interface DeliverableFillData {
  filled: boolean;
  appliedOps: number;
  usage?: { inputTokens: number; outputTokens: number };
  durationMs: number;
  leaksBefore?: number;
  leaksAfter?: number;
}

export type QuickVisualEngineDocumentResult =
  | ({
      ok: true;
      route: "template_skeleton";
      templateId: string;
      html: string;
      visualEngine: VisualEngineProjectMetadata;
    } & DeliverableFillData)
  | ({
      ok: true;
      route: "fallback";
      templateId: string;
      html: string;
      fallbackReasonCode: PilotReasonCode;
    } & DeliverableFillData)
  | { ok: false; kind: "template-unavailable" | "editor-marker-leak"; templateId: string };

export interface RunSkeletonCandidateDeps {
  fillAndNormalizeCuratedTemplate?: (
    input: FillAndNormalizeCuratedTemplateInput,
  ) => Promise<FillAndNormalizeCuratedTemplateResult>;
  adaptTemplateSkeleton?: typeof adaptTemplateSkeleton;
  finalizeCuratedDocument?: (input: FinalizeCuratedDocumentInput) => FinalizeCuratedDocumentResult;
}

function fillData(build: Extract<FillAndNormalizeCuratedTemplateResult, { ok: true }>): DeliverableFillData {
  return {
    filled: build.filled,
    appliedOps: build.appliedOps,
    usage: build.usage,
    durationMs: build.durationMs,
    leaksBefore: build.leaksBefore,
    leaksAfter: build.leaksAfter,
  };
}

async function buildFallback(
  input: SkeletonCandidateInput,
  reasonCode: PilotReasonCode,
  deps: Required<Pick<RunSkeletonCandidateDeps, "fillAndNormalizeCuratedTemplate" | "finalizeCuratedDocument">>,
): Promise<QuickVisualEngineDocumentResult> {
  const fallback = await deps.fillAndNormalizeCuratedTemplate({
    templateId: input.fallbackTemplateId,
    copy: input.copy,
    onStage: input.onStage,
  });
  if (!fallback.ok) return fallback;
  const finalized = deps.finalizeCuratedDocument({
    normalizedHtml: fallback.normalizedHtml,
    profileData: input.profileData,
    title: input.fallbackTitle,
    brandRecolor: true,
  });
  if (!finalized.ok) {
    return { ok: false, kind: finalized.kind, templateId: input.fallbackTemplateId };
  }
  return {
    ok: true,
    route: "fallback",
    templateId: input.fallbackTemplateId,
    html: finalized.html,
    fallbackReasonCode: reasonCode,
    ...fillData(fallback),
  };
}

/** Builds a user-visible skeleton atomically, or a complete weighted fallback. */
export async function runSkeletonCandidate(
  input: SkeletonCandidateInput,
  deps: RunSkeletonCandidateDeps = {},
): Promise<QuickVisualEngineDocumentResult> {
  const build = deps.fillAndNormalizeCuratedTemplate ?? fillAndNormalizeCuratedTemplate;
  const adapt = deps.adaptTemplateSkeleton ?? adaptTemplateSkeleton;
  const finalize = deps.finalizeCuratedDocument ?? finalizeCuratedDocument;
  const fallbackDeps = { fillAndNormalizeCuratedTemplate: build, finalizeCuratedDocument: finalize };

  try {
    const candidate = await build({
      templateId: input.candidateTemplateId,
      copy: input.copy,
      onStage: input.onStage,
    });
    if (!candidate.ok) return buildFallback(input, "internal_error", fallbackDeps);

    const adaptInput = {
      html: candidate.normalizedHtml,
      templateId: input.candidateTemplateId,
      intent: input.intent,
      templateMetadata: input.templateMetadata,
      brand: { accent: input.profileData.brand?.accent ?? null },
      ...(input.projectId && input.assetMode ? { assetContext: { mode: input.assetMode, projectId: input.projectId } } : {}),
    };
    const adapted = input.assetTraceSink
      ? await adapt(adaptInput, { onAssetTrace: input.assetTraceSink })
      : await adapt(adaptInput);
    if (!adapted.ok) return buildFallback(input, adapted.reasonCode, fallbackDeps);

    const finalized = finalize({
      normalizedHtml: adapted.html,
      profileData: input.profileData,
      title: input.candidateTitle,
      brandRecolor: false,
    });
    if (!finalized.ok) return buildFallback(input, "sanitization_failed", fallbackDeps);

    const visualEngineBase = {
      schemaVersion: "visual-engine-project/1.0" as const,
      route: "template_skeleton" as const,
      templateId: input.candidateTemplateId,
      creativeDirection: adapted.creativeDirection,
      promptVersion: adapted.promptVersion,
      policyVersion: input.policyVersion,
      contractVersion: "creative-direction/1.0" as const,
      structuralFingerprintBefore: adapted.structuralFingerprintBefore,
      structuralFingerprintAfter: adapted.structuralFingerprintAfter,
    };
    const visualEngine: VisualEngineProjectMetadata = adapted.assetManifest && adapted.assetTrace
      ? { ...visualEngineBase, assetManifest: adapted.assetManifest, assetTrace: adapted.assetTrace }
      : visualEngineBase;

    return {
      ok: true,
      route: "template_skeleton",
      templateId: input.candidateTemplateId,
      html: finalized.html,
      ...fillData(candidate),
      visualEngine,
    };
  } catch {
    return buildFallback(input, "internal_error", fallbackDeps);
  }
}

export interface CommitQuickVisualEngineDocumentDeps {
  emitPreview: (html: string) => void;
  persist: (data: ProjectData) => Promise<void>;
}

/** The only preview/persistence seam used after a skeleton candidate is accepted. */
export async function commitQuickVisualEngineDocument(
  document: { html: string; visualEngine?: VisualEngineProjectMetadata },
  deps: CommitQuickVisualEngineDocumentDeps,
): Promise<void> {
  const data: ProjectData = document.visualEngine
    ? { html: document.html, generation: { visualEngine: document.visualEngine } }
    : { html: document.html };
  deps.emitPreview(document.html);
  await deps.persist(data);
}

export interface ShadowSkeletonCandidateInput extends SkeletonCandidateInput {
  mode: "shadow";
}

type CaptureException = (
  error: Error,
  context: { route: string; stage: string; templateId: string; reasonCode: PilotReasonCode },
) => void;

export interface ShadowSkeletonCandidateDeps extends RunSkeletonCandidateDeps {
  reserveVisualEnginePilotRun?: typeof reserveVisualEnginePilotRun;
  completeVisualEnginePilotRun?: typeof completeVisualEnginePilotRun;
  captureException?: CaptureException;
}

function pilotOutcome(
  result: SkeletonAdaptationResult,
  policyVersion: string,
): CompleteVisualEnginePilotRunOutcome {
  if (!result.ok) {
    return {
      status: "fallback",
      reasonCode: result.reasonCode,
      promptVersion: result.promptVersion ?? undefined,
      contractVersion: "creative-direction/1.0",
      policyVersion,
      taxonomyVersion: TAXONOMY_COMPATIBILITY_VERSION,
      modelVersion: result.modelId ?? undefined,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      thinkingTokens: result.usage?.thinkingTokens,
      cachedTokens: result.usage?.cachedTokens,
      durationMs: result.durationMs,
      candidatePersisted: false,
      ...(result.reasonCode === "structural_invariant_failed" ? { structuralInvariantPassed: false } : {}),
    };
  }
  return {
    status: "adapted",
    promptVersion: result.promptVersion,
    contractVersion: result.creativeDirectionVersion,
    policyVersion,
    taxonomyVersion: TAXONOMY_COMPATIBILITY_VERSION,
    modelVersion: result.modelId,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    thinkingTokens: result.usage.thinkingTokens,
    cachedTokens: result.usage.cachedTokens,
    durationMs: result.durationMs,
    structuralFingerprintBefore: result.structuralFingerprintBefore,
    structuralFingerprintAfter: result.structuralFingerprintAfter,
    candidatePersisted: false,
    ...(result.structuralFingerprintBefore === result.structuralFingerprintAfter
      ? { structuralInvariantPassed: true }
      : {}),
  };
}

/** Runs a shadow-only candidate. It has no preview or persistence capability. */
export async function launchShadowSkeletonCandidate(
  input: ShadowSkeletonCandidateInput | null,
  deps: ShadowSkeletonCandidateDeps = {},
): Promise<void> {
  if (input === null) return;
  const build = deps.fillAndNormalizeCuratedTemplate ?? fillAndNormalizeCuratedTemplate;
  const adapt = deps.adaptTemplateSkeleton ?? adaptTemplateSkeleton;
  const finalize = deps.finalizeCuratedDocument ?? finalizeCuratedDocument;
  const reserve = deps.reserveVisualEnginePilotRun ?? reserveVisualEnginePilotRun;
  const complete = deps.completeVisualEnginePilotRun ?? completeVisualEnginePilotRun;
  const capture = deps.captureException ?? reportException;
  let reservationId: string | null = null;
  let completionAttempted = false;
  const attemptCompletion = async (
    id: string,
    outcome: CompleteVisualEnginePilotRunOutcome,
  ): Promise<void> => {
    completionAttempted = true;
    await complete(id, outcome);
  };

  try {
    const candidate = await build({
      templateId: input.candidateTemplateId,
      copy: input.copy,
      onStage: input.onStage,
    });
    if (!candidate.ok) return;

    const reservation = await reserve({
      phase: "2a",
      mode: "shadow",
      route: "template_skeleton",
      templateId: input.candidateTemplateId,
    });
    if (!reservation.ok) return;
    reservationId = reservation.id;

    const adaptInput = {
      html: candidate.normalizedHtml,
      templateId: input.candidateTemplateId,
      intent: input.intent,
      templateMetadata: input.templateMetadata,
      brand: { accent: input.profileData.brand?.accent ?? null },
      ...(input.projectId && input.assetMode ? { assetContext: { mode: input.assetMode, projectId: input.projectId } } : {}),
    };
    const adapted = input.assetTraceSink
      ? await adapt(adaptInput, { onAssetTrace: input.assetTraceSink })
      : await adapt(adaptInput);
    if (!adapted.ok) {
      await attemptCompletion(reservationId, pilotOutcome(adapted, input.policyVersion));
      return;
    }

    const finalized = finalize({
      normalizedHtml: adapted.html,
      profileData: input.profileData,
      title: input.candidateTitle,
      brandRecolor: false,
    });
    if (!finalized.ok) {
      const { structuralInvariantPassed: _structuralInvariantPassed, ...adaptedOutcome } = pilotOutcome(adapted, input.policyVersion);
      await attemptCompletion(reservationId, {
        ...adaptedOutcome,
        status: "fallback",
        reasonCode: "sanitization_failed",
        candidatePersisted: false,
      });
      return;
    }

    await attemptCompletion(reservationId, pilotOutcome(adapted, input.policyVersion));
  } catch {
    if (reservationId !== null && !completionAttempted) {
      await attemptCompletion(reservationId, {
        status: "failed",
        reasonCode: "internal_error",
        candidatePersisted: false,
      }).catch(() => undefined);
    }
    capture(new Error("Visual Engine shadow candidate failed"), {
      route: "curate",
      stage: "visual-engine-shadow",
      templateId: input.candidateTemplateId,
      reasonCode: "internal_error",
    });
  }
}
