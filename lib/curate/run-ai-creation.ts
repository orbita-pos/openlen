import type { BusinessProfileData } from "@/lib/business-profiles/types";
import type { AssetPipelineMode } from "@/lib/generation/asset-pipeline-mode";
import type { AssetResolutionTrace } from "@/lib/generation/asset-contracts";
import { listSections } from "@/lib/sections/store";
import {
  validateAiCompositionDelivery,
  type AiCompositionDeliveryReason,
} from "./ai-composition-delivery";
import {
  type AiCreationReasonCode,
  type AiCreationResult,
  type AiCreationStage,
} from "./ai-creation-contracts";
import { buildCreativeBaseline } from "./creative-baseline";
import { runCreativeDocument } from "./creative-document";
import { validateCreativeDocumentDelivery } from "./creative-document-delivery";
import { createFableRuntimeComposition, type FableRuntimeComposition, type FableRuntimeCompositionOptions } from "./fable-runtime-composition";

export interface RunAiCreationInput {
  projectId: string;
  brief: string;
  profileData: BusinessProfileData;
  assetMode: AssetPipelineMode;
  assetTraceSink?: (trace: AssetResolutionTrace) => void;
  onStage?: (stage: string) => void;
}

export interface RunAiCreationDeps {
  listSections?: typeof listSections;
  buildCreativeBaseline?: typeof buildCreativeBaseline;
  runCreativeDocument?: typeof runCreativeDocument;
  validateAiCompositionDelivery?: typeof validateAiCompositionDelivery;
  validateCreativeDocumentDelivery?: typeof validateCreativeDocumentDelivery;
  createFableRuntimeComposition?: typeof createFableRuntimeComposition;
  /** Low-level transports/renderers used by the real production root. */
  fableRuntimeOptions?: FableRuntimeCompositionOptions;
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

function deliveryReason(reasonCode: AiCompositionDeliveryReason): AiCreationReasonCode {
  return reasonCode === "asset_metadata_invalid" ? "asset_resolution_failed" : "semantic_gate_failed";
}

/**
 * Baseline first, then improvement.
 *
 * OpenLen builds a complete, safe page with no provider involved at all. That
 * page is the floor: from the moment it exists, no provider timeout, malformed
 * reply, rejected document, exhausted budget, or dead renderer may turn this
 * request into a failure. The creative model gets one chance to write something
 * better and one diagnosed chance to fix it; whatever survives the delivery
 * gate is what ships.
 *
 * The only failures left are the ones where there is genuinely nothing to
 * deliver: no section inventory, no safe baseline, or a baseline that cannot
 * pass its own gate.
 */
export async function runAiCreation(
  input: RunAiCreationInput,
  deps: RunAiCreationDeps = {},
): Promise<AiCreationResult> {
  let runtime: FableRuntimeComposition;
  try {
    runtime = (deps.createFableRuntimeComposition ?? createFableRuntimeComposition)(deps.fableRuntimeOptions);
  } catch {
    return failure("baseline", "baseline_invalid");
  }
  const loadSections = deps.listSections ?? listSections;
  const buildBaseline = deps.buildCreativeBaseline ?? buildCreativeBaseline;
  const writeDocument = deps.runCreativeDocument ?? runCreativeDocument;
  const validateComposed = deps.validateAiCompositionDelivery ?? validateAiCompositionDelivery;
  const validateDocument = deps.validateCreativeDocumentDelivery ?? validateCreativeDocumentDelivery;

  notify(input, "sections");
  const sectionCall = await callBoundary(() => loadSections({ status: "published" }));
  if (!sectionCall.ok || sectionCall.value.length === 0) {
    await runtime.recordFailure("initial_program", "section_inventory_unavailable");
    return failure("sections", "section_inventory_unavailable");
  }

  // The composition root owns every external boundary, rendering included, so
  // both passes measure through the same injected viewport renderer.
  const render = deps.fableRuntimeOptions?.renderViewports;
  const fetchText = deps.fableRuntimeOptions?.sectionFragmentFetch;

  notify(input, "baseline");
  const baselineCall = await callBoundary(() => buildBaseline({
    projectId: input.projectId,
    brief: input.brief,
    profileData: input.profileData,
    records: sectionCall.value,
  }, { ...(render ? { render } : {}), ...(fetchText ? { fetchText } : {}) }));
  if (!baselineCall.ok) {
    await runtime.recordFailure("baseline", "baseline_invalid");
    return failure("baseline", "baseline_invalid");
  }
  const baseline = baselineCall.value;
  if (!baseline.ok) {
    const reasonCode: AiCreationReasonCode = baseline.code === "section_inventory_unavailable"
      ? "section_inventory_unavailable"
      : "baseline_invalid";
    await runtime.recordFailure("baseline", reasonCode);
    return failure("baseline", reasonCode);
  }

  notify(input, "creative_document");
  const documentCall = await callBoundary(() => writeDocument({
    requestId: input.projectId,
    brief: input.brief,
    title: baseline.candidate.title,
    profileData: input.profileData,
    creativeDirection: baseline.candidate.visualEngine.creativeDirection,
    intent: baseline.intent,
  }, {
    client: runtime.documentClient,
    ...(render ? { render } : {}),
    recordModel: (result) => runtime.recordModel("creative_document", {
      modelId: result.modelId,
      ...(result.ok ? { usage: result.usage } : result.usage ? { usage: result.usage } : {}),
      durationMs: result.durationMs,
      attempts: 1,
      ...(!result.ok && result.providerCategory ? { providerCategory: result.providerCategory } : {}),
      ...(!result.ok && result.httpStatus !== undefined ? { httpStatus: result.httpStatus } : {}),
    }),
  }));

  notify(input, "delivery_gate");
  const authored = documentCall.ok ? documentCall.value.candidate : null;
  if (authored) {
    const validated = await callBoundary(() => validateDocument({ html: authored.html, visualEngine: authored.visualEngine }));
    if (validated.ok && validated.value.ok) {
      return {
        ok: true,
        route: "creative_document",
        templateId: null,
        title: authored.title,
        html: authored.html,
        visualEngine: validated.value.visualEngine,
        filled: true,
        appliedOps: 0,
        finalizeFableTelemetry: () => runtime.recordDelivered(),
        failFableTelemetry: (_stage, reasonCode) => runtime.recordFailure("delivery", reasonCode),
      };
    }
    // An authored page that cannot be delivered is an observation, not a
    // failure: the baseline underneath it is still a publishable page.
    await runtime.recordFailure("creative_document", "semantic_gate_failed");
  } else if (!documentCall.ok) {
    await runtime.recordFailure("creative_document", "creative_direction_failed");
  }

  const composed = await callBoundary(() => validateComposed({
    html: baseline.candidate.html,
    visualEngine: baseline.candidate.visualEngine,
    leaksAfter: 0,
  }));
  if (!composed.ok || !composed.value.ok) {
    const reasonCode: AiCreationReasonCode = composed.ok && !composed.value.ok
      ? deliveryReason(composed.value.reasonCode)
      : "semantic_gate_failed";
    await runtime.recordFailure("delivery_gate", reasonCode);
    return failure("delivery_gate", reasonCode);
  }

  return {
    ok: true,
    route: "section_composition",
    templateId: null,
    title: baseline.candidate.title,
    html: baseline.candidate.html,
    visualEngine: composed.value.visualEngine,
    filled: baseline.candidate.filled,
    appliedOps: baseline.candidate.appliedOps,
    finalizeFableTelemetry: () => runtime.recordDelivered(),
    failFableTelemetry: (_stage, reasonCode) => runtime.recordFailure("delivery", reasonCode),
  };
}
