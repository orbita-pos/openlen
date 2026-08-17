import type { BusinessProfileData } from "@/lib/business-profiles/types";
import { assessFinalVisualCandidate, isFinalVisualAcceptance } from "@/lib/ai/qwen-visual-critic";
import { renderVisualQualityViewports } from "@/lib/ai/visual-quality-renderer";
import type { IntentAnalysis } from "@/lib/generation/contracts";
import type { CreativeDirection } from "@/lib/generation/creative-contracts";
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
import { buildCreativeBaseline, type SafeCreativeCandidate } from "./creative-baseline";
import { resolveCreativeImage } from "./creative-image-resolution";
import { createCreativeSandbox } from "./creative-sandbox";
import { electCreativeDirectionWith } from "./elect-creative-direction";
import { runDeepSeekCreativeSession, type CreativeSessionDeps } from "./deepseek-creative-session";
import { runOptionalImageTool } from "./optional-image-tool";
import { createFableRuntimeComposition, type FableRuntimeComposition, type FableRuntimeCompositionOptions } from "./fable-runtime-composition";
import { runCreativeGeneration, type CreativeGenerationDeps } from "./run-creative-generation";

export interface RunAiCreationInput {
  projectId: string;
  brief: string;
  profileData: BusinessProfileData;
  /** Credits the user has before this page runs. Bounds what the page may
   * spend on photography; omitted, imagery falls back to the default. */
  creditBalance?: number;
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
  /** Asset boundary for the model's optional image tool. */
  resolveImage?: typeof resolveCreativeImage;
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

/** Photographs the page may buy. Two when the brief says nothing, because the
 * model is spending on the user's behalf and a niche that wants none should get
 * none. What the brief asks for when it asks, because that choice is the
 * user's. Never more than the balance can pay: one credit for the page, one per
 * image, so a brief demanding fifty photographs cannot empty an account. */
export const DEFAULT_PAGE_IMAGES = 2;

export function pageImageAllowance(intent: IntentAnalysis, creditBalance: number | undefined): number {
  const requested = intent.requestedImages ?? DEFAULT_PAGE_IMAGES;
  if (creditBalance === undefined) return Math.max(0, requested);
  return Math.max(0, Math.min(requested, Math.floor(creditBalance) - 1));
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
  resolveImage: typeof resolveCreativeImage,
  creditBalance: number | undefined,
  projectId: string,
): { deps: CreativeGenerationDeps; imagesApplied: () => number } {
  // The advisory reviewer needs the same bytes the render gate just produced.
  // Rendering is a browser launch; one document is rendered once.
  let lastRender: { html: string; result: Awaited<ReturnType<typeof renderViewports>> } | null = null;
  const renderFull = async (html: string) => {
    if (lastRender?.html === html) return lastRender.result;
    const result = await renderViewports(html);
    lastRender = { html, result };
    return result;
  };
  const render = async (html: string) => {
    const rendered = await renderFull(html);
    if (!rendered) return null;
    return {
      mobileOverflow: (rendered as { mobileOverflow?: boolean }).mobileOverflow === true,
      invalidGeometry: (rendered as { invalidGeometry?: boolean }).invalidGeometry === true,
    };
  };
  // Two counts, because they answer different questions: the provider bills
  // attempts, and the user may only be charged for photographs they got.
  let pageImageAttempts = 0;
  let pageImagesApplied = 0;

  const sandboxFor = (candidate: SafeCreativeCandidate) =>
    createCreativeSandbox(candidate, { sanitize: sanitizeForPublish, seal: sealRelease, render });
  const recordModel = (stage: "creative_session", result: Parameters<CreativeSessionDeps["recordModel"] & object>[1]) =>
    runtime.recordModel(stage, "modelId" in result ? result : {});

  const creativeSession = (
    session: { requestId: string; brief: string; intent: IntentAnalysis; issueSummary?: string; maxTurns?: 1 },
    candidate: SafeCreativeCandidate,
  ) => {
    const sandbox = sandboxFor(candidate);
    const direction = (candidate.visualEngine as { creativeDirection?: CreativeDirection }).creativeDirection;
    return runDeepSeekCreativeSession({ ...session, baseline: candidate }, {
      client: runtime.fireworksToolClient,
      sandbox,
      recordModel,
      // No creative direction means no taxonomy to resolve against, so the
      // image tool simply is not offered for that page.
      ...(direction ? {
        requestImage: async (request) => {
          const applied = await runOptionalImageTool({
            projectId: session.requestId,
            candidate: sandbox.current(),
            requests: [request],
            remaining: pageImageAllowance(session.intent, creditBalance) - pageImageAttempts,
          }, {
            resolve: () => resolveImage({
              projectId: session.requestId,
              intent: session.intent,
              direction,
              subject: request.subject,
              ...(request.mediaType ? { mediaType: request.mediaType } : {}),
            }, { provider: runtime.geminiAssetPackProvider }),
            recordImage: (trace) => {
              // The provider bills attempts, not results. Counting only what
              // landed let four paid attempts slip a two-image budget and cost
              // 5.03 MXN. A target that does not exist never reaches it and is
              // the one failure that is genuinely free.
              if (trace.code !== "unknown_target") pageImageAttempts += 1;
              if (trace.outcome === "applied") {
                pageImagesApplied += 1;
                runtime.recordImage({ modelId: "asset-pipeline", generatedCount: 1, durationMs: 0 });
              }
              // A refused image costs the page its photography and nothing
              // else, so it never showed up anywhere: the page still ships,
              // just barer than the model designed it.
              else runtime.recordDegraded("image", trace.code ?? "image_unavailable");
            },
          });
          if (!applied.applied) return { ok: false, code: "invalid_patch", detail: "image_unavailable" };
          return sandbox.adopt(applied.candidate);
        },
      } : {}),
    });
  };

  const deps: CreativeGenerationDeps = {
    buildBaseline: buildCreativeBaseline,
    // Sin esto la dirección sale del vecino más parecido entre 7 nichos, y sólo
    // existen 7 paletas para todos los usuarios. Apagable: con OPENLEN_DIRECTION=0
    // la página vuelve exactamente a como se generaba antes.
    ...(process.env.OPENLEN_DIRECTION === "0"
      ? {}
      : { chooseDirection: electCreativeDirectionWith(runtime.fireworksClient, projectId) }),
    renderCandidate: render,
    validateDelivery: validateAiCompositionDelivery,
    recordFailure: (stage, reasonCode) => { void runtime.recordFailure(telemetryStage(stage), reasonCode); },
    recordDegraded: (stage, reasonCode) => runtime.recordDegraded(telemetryStage(stage), reasonCode),
    runCreativeSession: (session) => creativeSession(session, session.baseline),
    runAdvisoryReview: (review) => runAdvisoryVisualReview(review, {
      render,
      review: async ({ html }) => {
        const rendered = await renderFull(html);
        if (!rendered) return { ok: false };
        const assessed = await assessFinalVisualCandidate({
          requestId: review.requestId,
          screenshots: { desktop: rendered.desktop, mobile: rendered.mobile },
          deterministic: {
            mobileOverflow: rendered.mobileOverflow === true,
            weakTypographyHierarchy: rendered.weakTypographyHierarchy === true,
            invalidGeometry: rendered.invalidGeometry === true,
          },
          brief: {
            niche: review.intent.functional.siteType,
            requiredSignals: review.intent.requiredVisualSignals,
            forbiddenSignals: review.intent.forbiddenVisualSignals,
          },
        }, { client: runtime.fireworksClient });
        runtime.recordModel("final_critic", "modelId" in assessed ? assessed : {});
        if (!assessed.ok) return { ok: false };
        return {
          ok: true,
          accepted: isFinalVisualAcceptance(assessed.verdict),
          // Codes only. The critic's prose never reaches the repair prompt.
          issues: assessed.verdict.issues.map((issue) => `${issue.code}:${issue.viewport}`),
        };
      },
      repair: (input) => creativeSession({
        requestId: input.requestId,
        brief: input.brief,
        intent: review.intent,
        issueSummary: input.issueSummary,
        maxTurns: 1,
      }, review.candidate),
    }),
  };
  return { deps, imagesApplied: () => pageImagesApplied };
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

  const production = productionDeps(
    runtime,
    deps.renderViewports ?? renderVisualQualityViewports,
    deps.resolveImage ?? resolveCreativeImage,
    input.creditBalance,
    input.projectId,
  );
  const generation = await (deps.runCreativeGeneration ?? runCreativeGeneration)({
    projectId: input.projectId,
    brief: input.brief,
    profileData: input.profileData,
    records,
    ...(input.onStage ? { onStage: input.onStage } : {}),
  }, {
    ...production.deps,
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
    generatedImages: production.imagesApplied(),
    // True when an improvement stage failed and the baseline shipped instead.
    // Delivering is operational success; this is how a caller tells that apart
    // from the model actually having designed the page.
    degraded: generation.degraded,
    finalizeFableTelemetry: () => runtime.recordDelivered(),
    failFableTelemetry: (_stage, reasonCode) => runtime.recordFailure("delivery", reasonCode),
  };
}
