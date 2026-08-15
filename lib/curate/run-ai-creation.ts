import type { BusinessProfileData } from "@/lib/business-profiles/types";
import { renderVisualQualityViewports } from "@/lib/ai/visual-quality-renderer";
import { FABLE_TELEMETRY_STAGES, type FableTelemetryStage } from "@/lib/generation/fable-generation-telemetry";
import { sanitizeForPublish, sealRelease } from "@/lib/html-engine";
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
import { runAdvisoryVisualReview } from "./advisory-visual-review";
import { buildCreativeBaseline } from "./creative-baseline";
import { createCreativeSandbox } from "./creative-sandbox";
import { runDeepSeekCreativeSession } from "./deepseek-creative-session";
import { createFableRuntimeComposition, type FableRuntimeComposition, type FableRuntimeCompositionOptions } from "./fable-runtime-composition";
import { runCreativeGeneration, type CreativeGenerationDeps } from "./run-creative-generation";

export interface RunAiCreationInput {
  projectId: string;
  brief: string;
  profileData: BusinessProfileData;
  onStage?: (stage: string) => void;
}

export interface RunAiCreationDeps {
  listSections?: typeof listSections;
  createFableRuntimeComposition?: typeof createFableRuntimeComposition;
  fableRuntimeOptions?: FableRuntimeCompositionOptions;
  runCreativeGeneration?: typeof runCreativeGeneration;
  /** Overrides for individual generation boundaries; anything omitted uses the
   * production wiring built from the runtime. */
  creativeGenerationDeps?: Partial<CreativeGenerationDeps>;
  /** Rendering seam so tests never launch a browser. */
  renderViewports?: typeof renderVisualQualityViewports;
  /** Fragment-body loader forwarded to the baseline. */
  fetchText?: (storageUrl: string) => Promise<string | null>;
}

function failure(stage: AiCreationStage, reasonCode: AiCreationReasonCode): AiCreationResult {
  return { ok: false, stage, reasonCode, retryable: true };
}

function notify(input: RunAiCreationInput, stage: string): void {
  try { input.onStage?.(stage); } catch {
    // Progress reporting cannot change delivery behavior.
  }
}

function baselineReason(code: string): AiCreationReasonCode {
  return code === "section_inventory_unavailable" ? "section_inventory_unavailable" : "composition_failed";
}

const TELEMETRY_STAGES = new Set<string>(FABLE_TELEMETRY_STAGES);

/** Keeps an unknown stage from making the operational sink drop the whole
 * event; the accounting still lands, under the delivery stage. */
function telemetryStage(stage: string): FableTelemetryStage {
  return TELEMETRY_STAGES.has(stage) ? (stage as FableTelemetryStage) : "delivery";
}

function deliveryReason(reasonCode: string): AiCreationReasonCode {
  return reasonCode === ("asset_metadata_invalid" satisfies AiCompositionDeliveryReason)
    ? "asset_resolution_failed"
    : "semantic_gate_failed";
}

function productionDeps(
  runtime: FableRuntimeComposition,
  renderViewports: typeof renderVisualQualityViewports,
): CreativeGenerationDeps {
  const render = async (html: string) => {
    const rendered = await renderViewports(html);
    if (!rendered) return null;
    return {
      mobileOverflow: (rendered as { mobileOverflow?: boolean }).mobileOverflow === true,
      invalidGeometry: (rendered as { invalidGeometry?: boolean }).invalidGeometry === true,
    };
  };

  return {
    buildBaseline: buildCreativeBaseline,
    validateDelivery: validateAiCompositionDelivery,
    recordFailure: (stage, reasonCode) => { void runtime.recordFailure(telemetryStage(stage), reasonCode); },
    recordDegraded: (stage, reasonCode) => runtime.recordDegraded(telemetryStage(stage), reasonCode),
    runCreativeSession: (session) => runDeepSeekCreativeSession(session, {
      client: runtime.fireworksToolClient,
      sandbox: createCreativeSandbox(session.baseline, { sanitize: sanitizeForPublish, seal: sealRelease, render }),
      recordModel: (stage, result) => runtime.recordModel(stage, "modelId" in result ? result : {}),
    }),
    // Qwen review stays unwired until Task 5 authorises live vision calls; an
    // absent reviewer is an accepted branch, not a failure.
    runAdvisoryReview: (review) => runAdvisoryVisualReview(review, {
      render,
      review: async () => ({ ok: false }),
      repair: async () => ({ candidate: review.candidate, changed: false, acceptedMutations: 0, stoppedBy: "provider" }),
    }),
  };
}

export async function runAiCreation(
  input: RunAiCreationInput,
  deps: RunAiCreationDeps = {},
): Promise<AiCreationResult> {
  let runtime: FableRuntimeComposition;
  try {
    runtime = (deps.createFableRuntimeComposition ?? createFableRuntimeComposition)(deps.fableRuntimeOptions);
  } catch {
    return failure("composition", "composition_failed");
  }

  notify(input, "sections");
  let records: Awaited<ReturnType<typeof listSections>>;
  try {
    records = await (deps.listSections ?? listSections)({ status: "published" });
  } catch {
    await runtime.recordFailure("initial_program", "section_inventory_unavailable");
    return failure("sections", "section_inventory_unavailable");
  }
  if (records.length === 0) {
    await runtime.recordFailure("initial_program", "section_inventory_unavailable");
    return failure("sections", "section_inventory_unavailable");
  }

  const generation = await (deps.runCreativeGeneration ?? runCreativeGeneration)({
    projectId: input.projectId,
    brief: input.brief,
    profileData: input.profileData,
    records,
    ...(input.onStage ? { onStage: input.onStage } : {}),
  }, {
    ...productionDeps(runtime, deps.renderViewports ?? renderVisualQualityViewports),
    ...(deps.fetchText ? { fetchText: deps.fetchText } : {}),
    ...deps.creativeGenerationDeps,
  });

  if (!generation.ok) {
    const reasonCode = generation.stage === "composition"
      ? baselineReason(generation.reasonCode)
      : deliveryReason(generation.reasonCode);
    await runtime.recordFailure(generation.stage === "composition" ? "initial_program" : "delivery_gate", reasonCode);
    return failure(generation.stage, reasonCode);
  }

  return {
    ok: true,
    route: "section_composition",
    templateId: null,
    title: generation.title,
    html: generation.html,
    visualEngine: generation.visualEngine,
    filled: generation.filled,
    appliedOps: generation.appliedOps,
    finalizeFableTelemetry: () => runtime.recordDelivered(),
    failFableTelemetry: (_stage, reasonCode) => runtime.recordFailure("delivery", reasonCode),
  };
}
