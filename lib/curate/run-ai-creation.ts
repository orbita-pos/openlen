import { overlayProfile } from "@/lib/business-profiles/overlay";
import type { BusinessProfileData } from "@/lib/business-profiles/types";
import type { AssetPipelineMode } from "@/lib/generation/asset-pipeline-mode";
import type { AssetResolutionTrace } from "@/lib/generation/asset-contracts";
import { canonicalJsonSha256 } from "@/lib/generation/content-hash";
import { listSections } from "@/lib/sections/store";
import {
  validateAiCompositionDelivery,
  type AiCompositionDeliveryReason,
} from "./ai-composition-delivery";
import {
  AI_HYBRID_POLICY_VERSION,
  type AiCreationReasonCode,
  type AiCreationResult,
  type AiCreationStage,
} from "./ai-creation-contracts";
import {
  runSectionCompositionCandidate,
  type QuickSectionCompositionResult,
} from "./quick-section-composition";
import type { FableFinalVisualGateResult, FableVisualRepairHandoff } from "./fable-final-visual-gate";
import type { VisualEngineProjectMetadata } from "@/lib/projects/types";
import { createFableRuntimeComposition, type FableRuntimeComposition, type FableRuntimeCompositionOptions, type FableRuntimeVisualBrief } from "./fable-runtime-composition";
import type { FableCopyResult, FableIntentResult } from "./fable-input-adapters";
import type { FableAdaptivePipelineDeps } from "./fable-adaptive-pipeline";

export interface RunAiCreationInput {
  projectId: string;
  brief: string;
  profileData: BusinessProfileData;
  assetMode: AssetPipelineMode;
  assetTraceSink?: (trace: AssetResolutionTrace) => void;
  onStage?: (stage: string) => void;
}

export interface RunAiCreationDeps {
  analyzeIntent?: (brief: string, requestId: string) => Promise<FableIntentResult>;
  generatePageCopy?: (brief: string, requestId: string) => Promise<FableCopyResult>;
  listSections?: typeof listSections;
  overlayProfile?: typeof overlayProfile;
  runSectionCompositionCandidate?: typeof runSectionCompositionCandidate;
  validateAiCompositionDelivery?: typeof validateAiCompositionDelivery;
  /** Injected by the adaptive composer; it owns Qwen screenshots and the one-repair machine. */
  runFableFinalVisualGate?: (input: {
    readonly requestId: string;
    readonly candidate: {
      readonly html: string;
      readonly visualEngine: Extract<VisualEngineProjectMetadata, { route: "section_composition" }>;
    };
    readonly handoff: FableVisualRepairHandoff;
    readonly brief: FableRuntimeVisualBrief;
  }) => Promise<FableFinalVisualGateResult>;
  createFableRuntimeComposition?: typeof createFableRuntimeComposition;
  /** Low-level transports/renderers used by the real production root. */
  fableRuntimeOptions?: FableRuntimeCompositionOptions;
  /** Test/runtime adapter for external rendering and storage boundaries only. */
  fableAdaptivePipelineDeps?: Omit<FableAdaptivePipelineDeps, "runtime" | "finalize">;
}

type BoundaryResult<T> =
  | { ok: true; value: T }
  | { ok: false };

function callBoundary<T>(call: () => T | Promise<T>): Promise<BoundaryResult<T>> {
  try {
    return Promise.resolve(call()).then(
      (value) => ({ ok: true, value }),
      () => ({ ok: false }),
    );
  } catch {
    return Promise.resolve({ ok: false });
  }
}

function failure(
  stage: AiCreationStage,
  reasonCode: AiCreationReasonCode,
): AiCreationResult {
  return { ok: false, stage, reasonCode, retryable: true };
}

function notify(input: RunAiCreationInput, stage: AiCreationStage): void {
  try {
    input.onStage?.(stage);
  } catch {
    // Progress reporting cannot change delivery behavior.
  }
}

function compositionReason(
  reasonCode: Extract<QuickSectionCompositionResult, { ok: false }>["reasonCode"],
): AiCreationReasonCode {
  switch (reasonCode) {
    case "unsupported_section_role":
    case "section_role_coverage_failed":
    case "section_semantic_coverage_failed":
    case "section_originality_failed":
      return "section_plan_failed";
    case "section_inventory_stale":
      return "section_inventory_unavailable";
    case "section_fragment_unavailable":
    case "section_fragment_stale":
    case "section_fragment_invalid":
      return "section_fragment_unavailable";
    case "inherited_copy_leak":
      return "inherited_copy_leak";
    case "provider_timeout":
    case "provider_error":
    case "budget_exceeded":
    case "invalid_provider_response":
    case "model_incompatible":
    case "css_policy_violation":
    case "contrast_violation":
      return "creative_direction_failed";
    case "required_asset_unavailable":
      return "asset_resolution_failed";
    case "route_ineligible":
    case "sanitization_failed":
    case "technical_render_failed":
    case "internal_error":
      return "composition_failed";
  }
}

function deliveryReason(
  reasonCode: AiCompositionDeliveryReason,
  leaksAfter: number,
): AiCreationReasonCode {
  if (leaksAfter !== 0) return "inherited_copy_leak";
  return reasonCode === "asset_metadata_invalid"
    ? "asset_resolution_failed"
    : "semantic_gate_failed";
}

export async function runAiCreation(
  input: RunAiCreationInput,
  deps: RunAiCreationDeps = {},
): Promise<AiCreationResult> {
  let runtime: FableRuntimeComposition;
  try {
    runtime = (deps.createFableRuntimeComposition ?? createFableRuntimeComposition)(deps.fableRuntimeOptions);
  } catch {
    return failure("intent", "intent_analysis_failed");
  }
  const analyze = deps.analyzeIntent ?? runtime.inputAdapters.analyzeIntent;
  const copyGenerator = deps.generatePageCopy ?? runtime.inputAdapters.generatePageCopy;
  const loadSections = deps.listSections ?? listSections;
  const overlay = deps.overlayProfile ?? overlayProfile;
  const compose = deps.runSectionCompositionCandidate ?? runSectionCompositionCandidate;
  const validate = deps.validateAiCompositionDelivery ?? validateAiCompositionDelivery;
  const finalGate = deps.runFableFinalVisualGate ?? runtime.runFinalGate;

  notify(input, "intent");
  const intentCall = await callBoundary(() => analyze(input.brief, input.projectId));
  if (!intentCall.ok || !intentCall.value.ok) {
    await runtime.recordFailure("intent", "intent_analysis_failed");
    return failure("intent", "intent_analysis_failed");
  }
  notify(input, "copy");
  const copyCall = await callBoundary(() => copyGenerator(input.brief, input.projectId));
  if (!copyCall.ok || !copyCall.value.ok) {
    await runtime.recordFailure("copy", "copy_generation_failed");
    return failure("copy", "copy_generation_failed");
  }
  const intentResult = intentCall.value;
  const copyResult = copyCall.value;

  let copy;
  try {
    copy = overlay(copyResult.copy, input.profileData);
  } catch {
    await runtime.recordFailure("copy", "copy_generation_failed");
    return failure("copy", "copy_generation_failed");
  }
  const title = copy.business_name?.trim() || "Untitled page";

  notify(input, "sections");
  const sectionCall = await callBoundary(() => loadSections({ status: "published" }));
  if (!sectionCall.ok || sectionCall.value.length === 0) {
    await runtime.recordFailure("initial_program", "section_inventory_unavailable");
    return failure("sections", "section_inventory_unavailable");
  }

  notify(input, "composition");
  const compositionInput = {
    allowGeneratedFallback: process.env.OPENLEN_AI_CREATION === "enabled",
    projectId: input.projectId,
    assetMode: input.assetMode,
    ...(input.assetTraceSink ? { assetTraceSink: input.assetTraceSink } : {}),
    candidateTitle: title,
    copy,
    profileData: input.profileData,
    intent: intentResult.intent,
    intentHash: canonicalJsonSha256(intentResult.intent),
    records: sectionCall.value,
    policyVersion: AI_HYBRID_POLICY_VERSION,
    fableRuntime: runtime,
    ...(input.onStage ? { onStage: input.onStage } : {}),
  };
  const compositionCall = await callBoundary(() => deps.fableAdaptivePipelineDeps
    ? compose(compositionInput, { fableAdaptivePipelineDeps: deps.fableAdaptivePipelineDeps })
    : compose(compositionInput));
  if (!compositionCall.ok) {
    await runtime.recordFailure("initial_program", "composition_failed");
    return failure("composition", "composition_failed");
  }
  const composition = compositionCall.value;
  if (!composition.ok) {
    const reasonCode = compositionReason(composition.reasonCode);
    await runtime.recordFailure("initial_program", reasonCode);
    return failure("composition", reasonCode);
  }

  notify(input, "delivery_gate");
  const leaksAfter = composition.leaksAfter ?? 0;
  let preRepair;
  try {
    preRepair = validate({
      html: composition.html,
      visualEngine: composition.visualEngine,
      leaksAfter,
    });
  } catch {
    await runtime.recordFailure("delivery_gate", leaksAfter === 0 ? "semantic_gate_failed" : "inherited_copy_leak");
    return failure("delivery_gate", leaksAfter === 0 ? "semantic_gate_failed" : "inherited_copy_leak");
  }
  if (!preRepair.ok) {
    const reasonCode = deliveryReason(preRepair.reasonCode, leaksAfter);
    await runtime.recordFailure("delivery_gate", reasonCode);
    return failure("delivery_gate", reasonCode);
  }
  if (leaksAfter !== 0) {
    await runtime.recordFailure("delivery_gate", "inherited_copy_leak");
    return failure("delivery_gate", "inherited_copy_leak");
  }

  // The final visual gate is deliberately mandatory. A legacy composition
  // without the adaptive handoff cannot be delivered through Create with AI.
  if (!composition.fableVisualRepairHandoff || !finalGate) {
    await runtime.recordFailure("visual_quality", "visual_quality_failed");
    return failure("visual_quality", "visual_quality_failed");
  }
  const fableHandoff = composition.fableVisualRepairHandoff;
  notify(input, "visual_quality");
  const visualCall = await callBoundary(() => finalGate({
    requestId: input.projectId,
    candidate: { html: composition.html, visualEngine: preRepair.visualEngine },
    handoff: fableHandoff,
    brief: {
      niche: intentResult.intent.functional.siteType,
      requiredSignals: intentResult.intent.requiredVisualSignals,
      forbiddenSignals: intentResult.intent.forbiddenVisualSignals,
    },
  }));
  if (!visualCall.ok || !visualCall.value.ok) {
    await runtime.recordFailure("visual_quality", "visual_quality_failed");
    return failure("visual_quality", "visual_quality_failed");
  }

  let postRepair;
  try {
    postRepair = validate({
      html: visualCall.value.candidate.html,
      visualEngine: visualCall.value.candidate.visualEngine,
      leaksAfter,
    });
  } catch {
    await runtime.recordFailure("delivery_gate", leaksAfter === 0 ? "semantic_gate_failed" : "inherited_copy_leak");
    return failure("delivery_gate", leaksAfter === 0 ? "semantic_gate_failed" : "inherited_copy_leak");
  }
  if (!postRepair.ok) {
    const reasonCode = deliveryReason(postRepair.reasonCode, leaksAfter);
    await runtime.recordFailure("delivery_gate", reasonCode);
    return failure("delivery_gate", reasonCode);
  }

  return {
    ok: true,
    route: "section_composition",
    templateId: null,
    title,
    html: visualCall.value.candidate.html,
    visualEngine: postRepair.visualEngine,
    ...(copyResult.usage ? { copyUsage: copyResult.usage } : {}),
    ...(composition.generatedSectionUsage ? { generatedSectionUsage: composition.generatedSectionUsage } : {}),
    ...(composition.generatedSectionCount ? { generatedSectionCount: composition.generatedSectionCount } : {}),
    filled: composition.filled,
    appliedOps: composition.appliedOps,
    finalizeFableTelemetry: () => runtime.recordDelivered(),
    failFableTelemetry: (_stage, reasonCode) => runtime.recordFailure("delivery", reasonCode),
  };
}
