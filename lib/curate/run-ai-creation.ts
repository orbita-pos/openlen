import { overlayProfile } from "@/lib/business-profiles/overlay";
import type { BusinessProfileData } from "@/lib/business-profiles/types";
import type { AssetPipelineMode } from "@/lib/generation/asset-pipeline-mode";
import type { AssetResolutionTrace } from "@/lib/generation/asset-contracts";
import { analyzeIntent } from "@/lib/generation/analyze-intent";
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
import { generatePageCopy } from "./generate-page-copy";
import {
  runSectionCompositionCandidate,
  type QuickSectionCompositionResult,
} from "./quick-section-composition";
import { runQuickVisualQualityGate } from "./quick-visual-repair";

export interface RunAiCreationInput {
  projectId: string;
  brief: string;
  profileData: BusinessProfileData;
  assetMode: AssetPipelineMode;
  assetTraceSink?: (trace: AssetResolutionTrace) => void;
  onStage?: (stage: string) => void;
}

export interface RunAiCreationDeps {
  analyzeIntent?: typeof analyzeIntent;
  generatePageCopy?: typeof generatePageCopy;
  listSections?: typeof listSections;
  overlayProfile?: typeof overlayProfile;
  runSectionCompositionCandidate?: typeof runSectionCompositionCandidate;
  validateAiCompositionDelivery?: typeof validateAiCompositionDelivery;
  runQuickVisualQualityGate?: typeof runQuickVisualQualityGate;
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
  const analyze = deps.analyzeIntent ?? analyzeIntent;
  const copyGenerator = deps.generatePageCopy ?? generatePageCopy;
  const loadSections = deps.listSections ?? listSections;
  const overlay = deps.overlayProfile ?? overlayProfile;
  const compose = deps.runSectionCompositionCandidate ?? runSectionCompositionCandidate;
  const validate = deps.validateAiCompositionDelivery ?? validateAiCompositionDelivery;
  const visualQuality = deps.runQuickVisualQualityGate ?? runQuickVisualQualityGate;

  notify(input, "intent");
  const intentPromise = callBoundary(() => analyze(input.brief));
  notify(input, "copy");
  const copyPromise = callBoundary(() => copyGenerator(input.brief));
  const [intentCall, copyCall] = await Promise.all([intentPromise, copyPromise]);

  if (!intentCall.ok) {
    return failure("intent", "intent_analysis_failed");
  }
  const intentResult = intentCall.value;
  if (!intentResult.ok) {
    return failure("intent", "intent_analysis_failed");
  }
  if (!copyCall.ok) {
    return failure("copy", "copy_generation_failed");
  }
  const copyResult = copyCall.value;
  if (!copyResult.ok) {
    return failure("copy", "copy_generation_failed");
  }

  let copy;
  try {
    copy = overlay(copyResult.copy, input.profileData);
  } catch {
    return failure("copy", "copy_generation_failed");
  }
  const title = copy.business_name?.trim() || "Untitled page";

  notify(input, "sections");
  const sectionCall = await callBoundary(() => loadSections({ status: "published" }));
  if (!sectionCall.ok || sectionCall.value.length === 0) {
    return failure("sections", "section_inventory_unavailable");
  }

  notify(input, "composition");
  const compositionCall = await callBoundary(() => compose({
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
    ...(input.onStage ? { onStage: input.onStage } : {}),
  }));
  if (!compositionCall.ok) {
    return failure("composition", "composition_failed");
  }
  const composition = compositionCall.value;
  if (!composition.ok) {
    return failure("composition", compositionReason(composition.reasonCode));
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
    return failure("delivery_gate", leaksAfter === 0 ? "semantic_gate_failed" : "inherited_copy_leak");
  }
  if (!preRepair.ok) {
    return failure("delivery_gate", deliveryReason(preRepair.reasonCode, leaksAfter));
  }
  if (leaksAfter !== 0) {
    return failure("delivery_gate", "inherited_copy_leak");
  }

  notify(input, "visual_quality");
  const qualityCall = await callBoundary(() => visualQuality({
    projectId: input.projectId,
    assetMode: input.assetMode,
    ...(input.assetTraceSink ? { assetTraceSink: input.assetTraceSink } : {}),
    html: composition.html,
    visualEngine: preRepair.visualEngine,
    intent: intentResult.intent,
    brandAccent: input.profileData.brand?.accent ?? null,
    explicitConstraints: intentResult.intent.explicitConstraints,
  }));
  if (!qualityCall.ok || !qualityCall.value.ok) {
    return failure("visual_quality", "visual_quality_failed");
  }

  notify(input, "delivery_gate");
  let postRepair;
  try {
    postRepair = validate({
      html: qualityCall.value.html,
      visualEngine: qualityCall.value.visualEngine,
      leaksAfter,
    });
  } catch {
    return failure("delivery_gate", "semantic_gate_failed");
  }
  if (!postRepair.ok) {
    return failure("delivery_gate", deliveryReason(postRepair.reasonCode, leaksAfter));
  }

  return {
    ok: true,
    route: "section_composition",
    templateId: null,
    title,
    html: qualityCall.value.html,
    visualEngine: postRepair.visualEngine,
    ...(copyResult.usage ? { copyUsage: copyResult.usage } : {}),
    filled: composition.filled,
    appliedOps: composition.appliedOps,
  };
}
