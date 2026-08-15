import type { ModelTokenUsage } from "./model-cost";
import type { PageBudget, RedactedPageCost } from "./page-generation-budget";
import { FIREWORKS_PROVIDER_CATEGORIES, type FireworksProviderCategory, type FireworksServiceTier } from "../ai/fireworks-contracts";
import { z } from "zod";

// One list, used by the types and every schema below. A stage missing from it
// makes the operational sink drop the whole event, silently.
export const FABLE_TELEMETRY_STAGES = [
  "intent",
  "copy",
  "scout",
  "page_plan",
  "initial_program",
  "baseline",
  "creative_session",
  "advisory_review",
  "image",
  "final_critic",
  "visual_repair",
  "delivery_gate",
  "delivery",
  "visual_quality",
] as const;

export type FableTelemetryStage = (typeof FABLE_TELEMETRY_STAGES)[number];

export interface FablePaidCallTelemetry {
  readonly stage: FableTelemetryStage;
  readonly kind: "model" | "image";
  readonly modelId: string;
  readonly usage: ModelTokenUsage | { readonly imageCount: number };
  readonly durationMs: number;
  readonly attempts: 0 | 1 | 2 | 3;
  readonly serviceTier?: FireworksServiceTier;
  readonly providerCategory?: FireworksProviderCategory;
  readonly httpStatus?: number;
}

/** A stage that failed without costing the page. The request still ends in
 * `delivered`; this is how we see what the user paid nothing for. */
export interface FableDegradationTelemetry {
  readonly stage: FableTelemetryStage;
  readonly reasonCode: string;
}

export interface FableGenerationTelemetryEvent {
  readonly schemaVersion: "fable-generation-telemetry/1.0";
  readonly outcome: "failed" | "delivered";
  readonly stage: FableTelemetryStage;
  readonly reasonCode: string | null;
  readonly paidCalls: readonly FablePaidCallTelemetry[];
  readonly degradations: readonly FableDegradationTelemetry[];
  readonly cost: RedactedPageCost | null;
}

export interface FableGenerationTelemetry {
  recordModel(call: Omit<FablePaidCallTelemetry, "kind"> & { readonly kind?: "model" }): void;
  recordImage(call: Omit<FablePaidCallTelemetry, "kind"> & { readonly kind?: "image"; readonly usage: { readonly imageCount: number } }): void;
  /** Non-terminal: it never consumes the single outcome event. */
  recordDegraded(input: { readonly stage: FableTelemetryStage; readonly reasonCode: string }): void;
  recordFailure(input: { readonly stage: FableTelemetryStage; readonly reasonCode: string }): Promise<void>;
  recordDelivered(): Promise<void>;
  snapshot(outcome: "failed" | "delivered", stage: FableTelemetryStage, reasonCode: string | null): FableGenerationTelemetryEvent;
}

const NonNegativeSafeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const ModelId = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:/+-]*$/);
const UsageSchema = z.object({
  inputTokens: NonNegativeSafeInteger,
  cachedTokens: NonNegativeSafeInteger,
  outputTokens: NonNegativeSafeInteger,
  thinkingTokens: NonNegativeSafeInteger,
}).strict();
const ImageUsageSchema = z.object({ imageCount: NonNegativeSafeInteger }).strict();
const StageSchema = z.enum(FABLE_TELEMETRY_STAGES);
const ReasonCode = z.string().min(1).max(80).regex(/^[a-z][a-z0-9_]*$/);
const PaidCallSchema = z.discriminatedUnion("kind", [
  z.object({
    stage: StageSchema,
    kind: z.literal("model"),
    modelId: ModelId,
    usage: UsageSchema,
    durationMs: NonNegativeSafeInteger,
    attempts: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    serviceTier: z.enum(["standard", "priority"]).optional(),
    providerCategory: z.enum(FIREWORKS_PROVIDER_CATEGORIES).optional(),
    httpStatus: z.number().int().min(100).max(599).optional(),
  }).strict(),
  z.object({ stage: StageSchema, kind: z.literal("image"), modelId: ModelId, usage: ImageUsageSchema, durationMs: NonNegativeSafeInteger, attempts: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]) }).strict(),
]);
const DegradationSchema = z.object({ stage: StageSchema, reasonCode: ReasonCode }).strict();
const CostSchema = z.object({
  rateCardVersion: z.string().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/),
  targetMicromxn: NonNegativeSafeInteger,
  capMicromxn: NonNegativeSafeInteger,
  actualMicromxn: NonNegativeSafeInteger,
  reservedMicromxn: NonNegativeSafeInteger,
  modelUsage: z.array(UsageSchema.extend({ modelId: ModelId, serviceTier: z.enum(["standard", "priority"]).optional(), costMicromxn: NonNegativeSafeInteger }).strict()).max(64),
  imageUsage: z.array(ImageUsageSchema.extend({ modelId: ModelId, costMicromxn: NonNegativeSafeInteger }).strict()).max(16),
}).strict();
const OperationalEventSchema = z.object({
  schemaVersion: z.literal("fable-generation-telemetry/1.0"),
  outcome: z.enum(["failed", "delivered"]),
  stage: StageSchema,
  reasonCode: ReasonCode.nullable(),
  paidCalls: z.array(PaidCallSchema).max(64),
  degradations: z.array(DegradationSchema).max(16),
  cost: CostSchema.nullable(),
}).strict();

export function createOperationalFableTelemetrySink(
  write: (line: string) => void = (line) => console.info(line),
): (event: FableGenerationTelemetryEvent) => Promise<void> {
  return async (event) => {
    try {
      const parsed = OperationalEventSchema.safeParse(event);
      if (!parsed.success) return;
      write(JSON.stringify(parsed.data));
    } catch {
      // The process journal must never widen a user-visible generation failure.
    }
  };
}

function safeDuration(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function safeAttempts(value: number): 0 | 1 | 2 | 3 {
  return value === 1 || value === 2 || value === 3 ? value : 0;
}

/** A reason code that fails the schema would drop the whole event, so codes are
 * coerced into the vocabulary instead of being trusted verbatim. */
function safeReasonCode(value: string): string {
  const coerced = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
  return /^[a-z][a-z0-9_]*$/.test(coerced) ? coerced : "unspecified";
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
  const degradations: FableDegradationTelemetry[] = [];
  const sink = options.sink ?? createOperationalFableTelemetrySink();
  let flushed = false;

  const snapshot = (outcome: "failed" | "delivered", stage: FableTelemetryStage, reasonCode: string | null): FableGenerationTelemetryEvent => ({
    schemaVersion: "fable-generation-telemetry/1.0",
    outcome,
    stage,
    reasonCode: reasonCode === null ? null : safeReasonCode(reasonCode),
    paidCalls: paidCalls.map((call) => ({ ...call, usage: call.kind === "model" ? modelUsage(call.usage as ModelTokenUsage) : { imageCount: (call.usage as { imageCount: number }).imageCount } })),
    degradations: [...degradations],
    cost: options.budget ? options.budget.snapshot() : null,
  });

  const emit = async (event: FableGenerationTelemetryEvent): Promise<void> => {
    if (flushed) return;
    flushed = true;
    try { await sink(event); } catch { /* telemetry cannot widen delivery failures */ }
  };

  return {
    recordModel(call) {
      paidCalls.push({
        stage: call.stage,
        kind: "model",
        modelId: call.modelId,
        usage: modelUsage(call.usage as ModelTokenUsage),
        durationMs: safeDuration(call.durationMs),
        attempts: safeAttempts(call.attempts),
        ...(call.serviceTier ? { serviceTier: call.serviceTier } : {}),
        ...(call.providerCategory ? { providerCategory: call.providerCategory } : {}),
        ...(call.httpStatus !== undefined ? { httpStatus: call.httpStatus } : {}),
      });
    },
    recordImage(call) {
      const imageCount = Number.isSafeInteger(call.usage.imageCount) && call.usage.imageCount >= 0 ? call.usage.imageCount : 0;
      paidCalls.push({ stage: call.stage, kind: "image", modelId: call.modelId, usage: { imageCount }, durationMs: safeDuration(call.durationMs), attempts: safeAttempts(call.attempts) });
    },
    recordDegraded({ stage, reasonCode }) {
      if (degradations.length >= 16) return;
      degradations.push({ stage, reasonCode: safeReasonCode(reasonCode) });
    },
    recordFailure({ stage, reasonCode }) { return emit(snapshot("failed", stage, reasonCode)); },
    recordDelivered() { return emit(snapshot("delivered", "delivery", null)); },
    snapshot,
  };
}
