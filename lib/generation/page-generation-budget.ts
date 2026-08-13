import {
  calculateImageUsageMicromxn,
  calculateModelUsageMicromxn,
  type ImageUsage,
  type ModelTokenUsage,
  type ProductionImageRate,
  type ProductionModelRate,
} from "./model-cost";

export const FABLE_PRODUCTION_RATES = Object.freeze({
  "accounts/fireworks/models/deepseek-v4-flash": Object.freeze({ input: .14, cached: .028, output: .28 }),
  "accounts/fireworks/models/glm-5p2": Object.freeze({ input: 1.40, cached: .14, output: 4.40 }),
  "accounts/fireworks/models/qwen3p7-plus": Object.freeze({ input: .50, cached: .10, output: 3.00 }),
  "gemini-2.5-flash-image": Object.freeze({ image: .039 }),
});

export type ProductionRateMap = Readonly<Record<string, ProductionModelRate | ProductionImageRate>>;

export type PlannedPaidCall =
  | { kind: "model"; modelId: string; maxInputTokens: number; maxOutputTokens: number }
  | { kind: "image"; modelId: string; imageCount: number };

export interface RedactedPageCost {
  rateCardVersion: string;
  targetMicromxn: number;
  capMicromxn: number;
  actualMicromxn: number;
  reservedMicromxn: number;
  modelUsage: readonly (ModelTokenUsage & { modelId: string; costMicromxn: number })[];
  imageUsage: readonly (ImageUsage & { modelId: string; costMicromxn: number })[];
}

export interface PageBudget {
  reserve(call: PlannedPaidCall): { ok: true; leaseId: string } | { ok: false; code: "budget_exceeded" };
  complete(leaseId: string, usage: ModelTokenUsage | ImageUsage): void;
  snapshot(): RedactedPageCost;
}

export interface PageBudgetConfig {
  rateCardVersion: string;
  mxnPerUsd: number;
  targetMicromxn: number;
  capMicromxn: number;
  rates: ProductionRateMap;
}

type Environment = Readonly<Record<string, string | undefined>>;
type Lease = PlannedPaidCall & { reservedMicromxn: number };

function positiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a safe positive integer`);
}

function positiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a finite positive number`);
}

function textRate(rates: ProductionRateMap, modelId: string): ProductionModelRate {
  const rate = rates[modelId];
  if (!rate || !("input" in rate) || !("cached" in rate) || !("output" in rate)) throw new Error("unknown text model");
  positiveFinite(rate.input, "input rate");
  positiveFinite(rate.cached, "cached rate");
  positiveFinite(rate.output, "output rate");
  return rate;
}

function imageRate(rates: ProductionRateMap, modelId: string): ProductionImageRate {
  const rate = rates[modelId];
  if (!rate || !("image" in rate)) throw new Error("unknown image model");
  positiveFinite(rate.image, "image rate");
  return rate;
}

function reservationCost(call: PlannedPaidCall, config: PageBudgetConfig): number {
  if (call.kind === "image") {
    positiveSafeInteger(call.imageCount, "imageCount");
    return calculateImageUsageMicromxn({ imageCount: call.imageCount }, imageRate(config.rates, call.modelId), config.mxnPerUsd);
  }
  positiveSafeInteger(call.maxInputTokens, "maxInputTokens");
  positiveSafeInteger(call.maxOutputTokens, "maxOutputTokens");
  return calculateModelUsageMicromxn({
    inputTokens: call.maxInputTokens,
    cachedTokens: 0,
    outputTokens: call.maxOutputTokens,
    thinkingTokens: 0,
  }, textRate(config.rates, call.modelId), config.mxnPerUsd);
}

function validateConfig(config: PageBudgetConfig): void {
  if (!config.rateCardVersion.trim()) throw new Error("rateCardVersion is required");
  positiveFinite(config.mxnPerUsd, "mxnPerUsd");
  positiveSafeInteger(config.targetMicromxn, "targetMicromxn");
  positiveSafeInteger(config.capMicromxn, "capMicromxn");
  if (config.targetMicromxn > config.capMicromxn) throw new Error("targetMicromxn cannot exceed capMicromxn");
  if (config.capMicromxn > 10_000_000) throw new Error("capMicromxn cannot exceed 10000000");
  for (const modelId of Object.keys(FABLE_PRODUCTION_RATES)) {
    if (modelId === "gemini-2.5-flash-image") imageRate(config.rates, modelId);
    else textRate(config.rates, modelId);
  }
}

export function createPageGenerationBudget(config: PageBudgetConfig): PageBudget {
  validateConfig(config);
  const leases = new Map<string, Lease>();
  const modelUsage: Array<ModelTokenUsage & { modelId: string; costMicromxn: number }> = [];
  const imageUsage: Array<ImageUsage & { modelId: string; costMicromxn: number }> = [];
  let actualMicromxn = 0;
  let reservedMicromxn = 0;
  let nextLease = 1;

  return {
    reserve(call) {
      const cost = reservationCost(call, config);
      if (cost > config.capMicromxn - actualMicromxn - reservedMicromxn) return { ok: false, code: "budget_exceeded" };
      const leaseId = `page-cost-${nextLease++}`;
      leases.set(leaseId, { ...call, reservedMicromxn: cost });
      reservedMicromxn += cost;
      return { ok: true, leaseId };
    },
    complete(leaseId, usage) {
      const lease = leases.get(leaseId);
      if (!lease) throw new Error("unknown or completed budget lease");
      leases.delete(leaseId);
      reservedMicromxn -= lease.reservedMicromxn;
      try {
        if (lease.kind === "model") {
          const cost = calculateModelUsageMicromxn(usage as ModelTokenUsage, textRate(config.rates, lease.modelId), config.mxnPerUsd);
          if (cost > lease.reservedMicromxn) throw new Error("reported usage exceeds reservation");
          actualMicromxn += cost;
          modelUsage.push({ ...(usage as ModelTokenUsage), modelId: lease.modelId, costMicromxn: cost });
        } else {
          const image = usage as ImageUsage;
          if (!Number.isSafeInteger(image?.imageCount) || image.imageCount < 0 || image.imageCount > lease.imageCount) throw new Error("complete image usage is required");
          const cost = image.imageCount === 0 ? 0 : calculateImageUsageMicromxn(image, imageRate(config.rates, lease.modelId), config.mxnPerUsd);
          actualMicromxn += cost;
          imageUsage.push({ imageCount: image.imageCount, modelId: lease.modelId, costMicromxn: cost });
        }
      } catch (error) {
        actualMicromxn += lease.reservedMicromxn;
        throw error;
      }
    },
    snapshot() {
      return {
        rateCardVersion: config.rateCardVersion,
        targetMicromxn: config.targetMicromxn,
        capMicromxn: config.capMicromxn,
        actualMicromxn,
        reservedMicromxn,
        modelUsage: modelUsage.map((usage) => ({ ...usage })),
        imageUsage: imageUsage.map((usage) => ({ ...usage })),
      };
    },
  };
}

function requiredNumber(env: Environment, key: string): number {
  const raw = env[key];
  if (!raw?.trim()) throw new Error(`${key} is required`);
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${key} must be finite`);
  return value;
}

export function parseFablePageBudgetConfigFromEnv(env: Environment = process.env): PageBudgetConfig {
  const rateCardVersion = env.OPENLEN_FABLE_RATE_CARD_VERSION?.trim();
  if (!rateCardVersion) throw new Error("OPENLEN_FABLE_RATE_CARD_VERSION is required");
  const config = {
    rateCardVersion,
    mxnPerUsd: requiredNumber(env, "OPENLEN_FABLE_MXN_PER_USD"),
    targetMicromxn: requiredNumber(env, "OPENLEN_FABLE_PAGE_TARGET_MICROMXN"),
    capMicromxn: requiredNumber(env, "OPENLEN_FABLE_PAGE_CAP_MICROMXN"),
    rates: FABLE_PRODUCTION_RATES,
  };
  validateConfig(config);
  return config;
}
