import type { ModelTokenUsage } from "./model-cost";
import type { PageBudget, RedactedPageCost } from "./page-generation-budget";

export type FableTelemetryStage = "intent" | "copy" | "scout" | "page_plan" | "initial_program" | "image" | "final_critic" | "visual_repair" | "delivery" | "visual_quality";

export interface FablePaidCallTelemetry {
  readonly stage: FableTelemetryStage;
  readonly kind: "model" | "image";
  readonly modelId: string;
  readonly usage: ModelTokenUsage | { readonly imageCount: number };
  readonly durationMs: number;
  readonly attempts: 0 | 1 | 2 | 3;
}

export interface FableGenerationTelemetryEvent {
  readonly schemaVersion: "fable-generation-telemetry/1.0";
  readonly outcome: "failed" | "delivered";
  readonly stage: FableTelemetryStage;
  readonly reasonCode: string | null;
  readonly paidCalls: readonly FablePaidCallTelemetry[];
  readonly cost: RedactedPageCost | null;
}

export interface FableGenerationTelemetry {
  recordModel(call: Omit<FablePaidCallTelemetry, "kind"> & { readonly kind?: "model" }): void;
  recordImage(call: Omit<FablePaidCallTelemetry, "kind"> & { readonly kind?: "image"; readonly usage: { readonly imageCount: number } }): void;
  recordFailure(input: { readonly stage: FableTelemetryStage; readonly reasonCode: string }): Promise<void>;
  recordDelivered(): Promise<void>;
  snapshot(outcome: "failed" | "delivered", stage: FableTelemetryStage, reasonCode: string | null): FableGenerationTelemetryEvent;
}

function safeDuration(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function safeAttempts(value: number): 0 | 1 | 2 | 3 {
  return value === 1 || value === 2 || value === 3 ? value : 0;
}

function modelUsage(value: ModelTokenUsage): ModelTokenUsage {
  return {
    inputTokens: Number.isSafeInteger(value.inputTokens) && value.inputTokens >= 0 ? value.inputTokens : 0,
    cachedTokens: Number.isSafeInteger(value.cachedTokens) && value.cachedTokens >= 0 ? value.cachedTokens : 0,
    outputTokens: Number.isSafeInteger(value.outputTokens) && value.outputTokens >= 0 ? value.outputTokens : 0,
    thinkingTokens: Number.isSafeInteger(value.thinkingTokens) && value.thinkingTokens >= 0 ? value.thinkingTokens : 0,
  };
}

/**
 * Stores only cost-accounting facts. The API deliberately has no field that
 * accepts payloads, document bytes, visual bytes, identities, or destinations.
 */
export function createFableGenerationTelemetry(options: {
  readonly sink?: (event: FableGenerationTelemetryEvent) => void | Promise<void>;
  readonly budget?: PageBudget;
} = {}): FableGenerationTelemetry {
  const paidCalls: FablePaidCallTelemetry[] = [];
  let flushed = false;

  const snapshot = (outcome: "failed" | "delivered", stage: FableTelemetryStage, reasonCode: string | null): FableGenerationTelemetryEvent => ({
    schemaVersion: "fable-generation-telemetry/1.0",
    outcome,
    stage,
    reasonCode,
    paidCalls: paidCalls.map((call) => ({ ...call, usage: call.kind === "model" ? modelUsage(call.usage as ModelTokenUsage) : { imageCount: (call.usage as { imageCount: number }).imageCount } })),
    cost: options.budget ? options.budget.snapshot() : null,
  });

  const emit = async (event: FableGenerationTelemetryEvent): Promise<void> => {
    if (flushed) return;
    flushed = true;
    try { await options.sink?.(event); } catch { /* telemetry cannot widen delivery failures */ }
  };

  return {
    recordModel(call) {
      paidCalls.push({ stage: call.stage, kind: "model", modelId: call.modelId, usage: modelUsage(call.usage as ModelTokenUsage), durationMs: safeDuration(call.durationMs), attempts: safeAttempts(call.attempts) });
    },
    recordImage(call) {
      const imageCount = Number.isSafeInteger(call.usage.imageCount) && call.usage.imageCount >= 0 ? call.usage.imageCount : 0;
      paidCalls.push({ stage: call.stage, kind: "image", modelId: call.modelId, usage: { imageCount }, durationMs: safeDuration(call.durationMs), attempts: safeAttempts(call.attempts) });
    },
    recordFailure({ stage, reasonCode }) { return emit(snapshot("failed", stage, reasonCode)); },
    recordDelivered() { return emit(snapshot("delivered", "delivery", null)); },
    snapshot,
  };
}
