import { assessFinalVisualCandidate } from "@/lib/ai/qwen-visual-critic";
import { createFireworksJsonClient, type FireworksJsonClient, type FireworksJsonClientOptions } from "@/lib/ai/fireworks-client";
import type { FireworksProviderCategory, FireworksServiceTier } from "@/lib/ai/fireworks-contracts";
import { renderVisualQualityViewports } from "@/lib/ai/visual-quality-renderer";
import { createFableGenerationTelemetry, type FableGenerationTelemetryEvent, type FableTelemetryStage } from "@/lib/generation/fable-generation-telemetry";
import { createGeminiAssetPackProvider, type GeminiAssetPackProviderOptions } from "@/lib/generation/gemini-asset-pack-provider";
import { createFireworksToolClient, type FireworksToolClient } from "@/lib/ai/fireworks-tool-client";
import { createGlmSectionProgramProvider, type GlmSectionProgramProvider } from "@/lib/generation/glm-section-program-provider";
import { createGlmVisualRepairProvider, type GlmVisualRepairProvider } from "@/lib/generation/glm-visual-repair";
import {
  createPageGenerationBudget,
  parseFablePageBudgetConfigFromEnv,
  type PageBudget,
  type PageBudgetConfig,
} from "@/lib/generation/page-generation-budget";

import {
  runFableFinalVisualGate,
  type FableFinalVisualGateResult,
  type FableInspection,
  type FableVisualRepairHandoff,
} from "./fable-final-visual-gate";
import { createFableInputAdapters, type FableInputAdapters } from "./fable-input-adapters";

export interface FableRuntimeVisualBrief {
  readonly niche: string;
  readonly requiredSignals: readonly string[];
  readonly forbiddenSignals: readonly string[];
}

export interface FableRuntimeCompositionOptions {
  /** The factory creates this once per page and passes it to every paid seam. */
  readonly budgetConfig?: PageBudgetConfig;
  readonly pageBudget?: PageBudget;
  readonly client?: FireworksJsonClient;
  readonly toolClient?: FireworksToolClient;
  readonly fireworksClientOptions?: Omit<FireworksJsonClientOptions, "budget">;
  readonly geminiAssetPackProviderOptions?: Omit<GeminiAssetPackProviderOptions, "pageBudget">;
  readonly renderViewports?: typeof renderVisualQualityViewports;
  readonly inspect?: (candidate: Parameters<typeof runFableFinalVisualGate>[0]["candidate"]) => Promise<FableInspection>;
  readonly repairProvider?: GlmVisualRepairProvider;
  readonly applyDelta?: Parameters<typeof runFableFinalVisualGate>[1]["applyDelta"];
  readonly telemetrySink?: (event: FableGenerationTelemetryEvent) => void | Promise<void>;
}

export interface FableRuntimeComposition {
  readonly pageBudget: PageBudget;
  readonly fireworksClient: FireworksJsonClient;
  /** Tool-calling transport for the creative sandbox. Shares the one page
   * budget with every other paid call in the request. */
  readonly fireworksToolClient: FireworksToolClient;
  /** Task 4 composition seams, all bound to this page's sole budget. */
  readonly glmSectionProgramProvider: GlmSectionProgramProvider;
  readonly geminiAssetPackProvider: ReturnType<typeof createGeminiAssetPackProvider>;
  readonly inputAdapters: FableInputAdapters;
  recordModel(stage: FableTelemetryStage, result: {
    readonly modelId?: string | null;
    readonly usage?: { readonly inputTokens: number; readonly cachedTokens: number; readonly outputTokens: number; readonly thinkingTokens: number };
    readonly durationMs?: number;
    readonly attempts?: 0 | 1 | 2 | 3;
    readonly serviceTier?: FireworksServiceTier;
    readonly providerCategory?: FireworksProviderCategory;
    readonly httpStatus?: number;
  }): void;
  recordImage(trace: { readonly modelId?: string | null; readonly generatedCount: number; readonly durationMs: number }): void;
  recordFailure(stage: "intent" | "copy" | "scout" | "page_plan" | "initial_program" | "image" | "delivery_gate" | "visual_quality" | "delivery", reasonCode: string): Promise<void>;
  recordDelivered(): Promise<void>;
  runFinalGate(input: {
    readonly requestId: string;
    readonly candidate: Parameters<typeof runFableFinalVisualGate>[0]["candidate"];
    readonly handoff: FableVisualRepairHandoff;
    readonly brief: FableRuntimeVisualBrief;
  }): Promise<FableFinalVisualGateResult>;
}

function defaultInspect(candidate: Parameters<typeof runFableFinalVisualGate>[0]["candidate"], renderViewports = renderVisualQualityViewports): Promise<FableInspection> {
  return renderViewports(candidate.html).then((rendered) => {
    if (!rendered) {
      return {
        ok: false,
        deterministic: { mobileOverflow: false, weakTypographyHierarchy: false, invalidGeometry: true },
        screenshots: { desktop: { mimeType: "image/jpeg", dataBase64: "" }, mobile: { mimeType: "image/jpeg", dataBase64: "" } },
      };
    }
    return {
      ok: true,
      deterministic: {
        mobileOverflow: rendered.mobileOverflow === true,
        weakTypographyHierarchy: rendered.weakTypographyHierarchy === true,
        invalidGeometry: rendered.invalidGeometry === true,
      },
      screenshots: { desktop: rendered.desktop, mobile: rendered.mobile },
    };
  }).catch(() => ({
    ok: false,
    deterministic: { mobileOverflow: false, weakTypographyHierarchy: false, invalidGeometry: true },
    screenshots: { desktop: { mimeType: "image/jpeg", dataBase64: "" }, mobile: { mimeType: "image/jpeg", dataBase64: "" } },
  }));
}

/**
 * Production composition root for the final Fable loop. It is intentionally
 * the only place that creates a Fable PageBudget and Fireworks client, so Qwen
 * and the one permitted GLM repair cannot accidentally use separate budgets.
 */
export function createFableRuntimeComposition(options: FableRuntimeCompositionOptions = {}): FableRuntimeComposition {
  const pageBudget = options.pageBudget ?? createPageGenerationBudget(options.budgetConfig ?? parseFablePageBudgetConfigFromEnv());
  const fireworksClient = options.client ?? createFireworksJsonClient({ ...options.fireworksClientOptions, budget: pageBudget });
  const fireworksToolClient = options.toolClient ?? createFireworksToolClient({ budget: pageBudget });
  const glmSectionProgramProvider = createGlmSectionProgramProvider({ client: fireworksClient });
  const geminiAssetPackProvider = createGeminiAssetPackProvider({ ...options.geminiAssetPackProviderOptions, pageBudget });
  const telemetry = createFableGenerationTelemetry({ budget: pageBudget, sink: options.telemetrySink });
  const recordModel: FableRuntimeComposition["recordModel"] = (stage, result) => {
    if (!result.modelId) return;
    telemetry.recordModel({
      stage,
      modelId: result.modelId,
      usage: result.usage ?? { inputTokens: 0, cachedTokens: 0, outputTokens: 0, thinkingTokens: 0 },
      durationMs: result.durationMs ?? 0,
      attempts: result.attempts ?? 0,
      ...(result.serviceTier ? { serviceTier: result.serviceTier } : {}),
      ...(result.providerCategory ? { providerCategory: result.providerCategory } : {}),
      ...(result.httpStatus !== undefined ? { httpStatus: result.httpStatus } : {}),
    });
  };
  const recordImage: FableRuntimeComposition["recordImage"] = (trace) => {
    if (!trace.modelId) return;
    telemetry.recordImage({
      stage: "image",
      modelId: trace.modelId,
      usage: { imageCount: trace.generatedCount },
      durationMs: trace.durationMs,
      attempts: 1,
    });
  };
  const rawInputAdapters = createFableInputAdapters({ client: fireworksClient });
  const inputAdapters: FableInputAdapters = {
    async analyzeIntent(brief, requestId) {
      const result = await rawInputAdapters.analyzeIntent(brief, requestId);
      recordModel("intent", result);
      return result;
    },
    async generatePageCopy(brief, requestId) {
      const result = await rawInputAdapters.generatePageCopy(brief, requestId);
      recordModel("copy", result);
      return result;
    },
  };
  const inspect = options.inspect ?? ((candidate) => defaultInspect(candidate, options.renderViewports));
  const configuredRepairProvider = options.repairProvider ?? createGlmVisualRepairProvider({ client: fireworksClient });
  const repairProvider: GlmVisualRepairProvider = {
    async repair(request) {
      const repaired = await configuredRepairProvider.repair(request);
      recordModel("visual_repair", "modelId" in repaired ? repaired : {});
      return repaired;
    },
  };

  return {
    pageBudget,
    fireworksClient,
    fireworksToolClient,
    glmSectionProgramProvider,
    geminiAssetPackProvider,
    inputAdapters,
    recordModel,
    recordImage,
    recordFailure: (stage, reasonCode) => telemetry.recordFailure({ stage, reasonCode }),
    recordDelivered: () => telemetry.recordDelivered(),
    async runFinalGate(input) {
      try {
        const result = await runFableFinalVisualGate({
          requestId: input.requestId,
          candidate: input.candidate,
          handoff: input.handoff,
        }, {
          inspect,
          repairProvider,
          // The adaptive composer retains this closure only for the live
          // request. It recompiles affected ASTs and reassembles/rerenders;
          // nothing program-shaped reaches project persistence or telemetry.
          applyDelta: input.handoff.applyDelta ?? options.applyDelta ?? (async () => ({ ok: false })),
          critique: async ({ requestId, screenshots, deterministic }) => {
            const reviewed = await assessFinalVisualCandidate({ requestId, screenshots, deterministic, brief: input.brief }, { client: fireworksClient });
            if (!reviewed.ok) {
              recordModel("final_critic", "modelId" in reviewed ? reviewed : {});
              return { ok: false };
            }
            recordModel("final_critic", reviewed);
            return { ok: true, verdict: reviewed.verdict };
          },
        });
        if (!result.ok) await telemetry.recordFailure({ stage: "visual_quality", reasonCode: result.code });
        return result;
      } catch {
        await telemetry.recordFailure({ stage: "visual_quality", reasonCode: "internal_error" });
        return { ok: false, code: "qwen_failed" };
      }
    },
  };
}
