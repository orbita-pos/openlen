export interface ModelRateCard {
  version: string;
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion: number;
  outputUsdPerMillion: number;
  thinkingUsdPerMillion: number;
}

export interface ModelTokenUsage {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  thinkingTokens: number;
}

export interface ProductionModelRate {
  input: number;
  cached: number;
  output: number;
}

export interface ImageUsage {
  imageCount: number;
}

export interface ProductionImageRate {
  image: number;
}

export interface PilotModelUsage {
  creative: ModelTokenUsage;
  critic: ModelTokenUsage;
  failedCalls?: readonly ModelTokenUsage[];
  duplicateShadowCandidateFill?: ModelTokenUsage;
}

export interface IntentOnlyModelUsage {
  intent: ModelTokenUsage;
}

export type PilotRateCard = ModelRateCard;

export interface CostBreakdown {
  productionEquivalentCostMicromxn: number;
  observedPilotCostMicromxn: number;
}

export interface PilotRateCardConfig extends ModelRateCard {
  mxnPerUsd: number;
}

function positiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a finite positive number`);
}

function nonnegativeFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a finite nonnegative number`);
  return value;
}

function usageMicromxn(usage: ModelTokenUsage, rateCard: ModelRateCard, mxnPerUsd: number): number {
  const input = nonnegativeFinite(usage.inputTokens, "inputTokens");
  const cached = nonnegativeFinite(usage.cachedTokens, "cachedTokens");
  const output = nonnegativeFinite(usage.outputTokens, "outputTokens");
  const thinking = nonnegativeFinite(usage.thinkingTokens, "thinkingTokens");
  const billableInput = Math.max(0, input - cached);
  const usd = (
    (billableInput * rateCard.inputUsdPerMillion)
    + (cached * rateCard.cachedInputUsdPerMillion)
    + (output * rateCard.outputUsdPerMillion)
    + (thinking * rateCard.thinkingUsdPerMillion)
  ) / 1_000_000;
  return Math.round(usd * mxnPerUsd * 1_000_000);
}

interface Fraction { numerator: bigint; denominator: bigint }

function decimalFraction(value: number, name: string): Fraction {
  positiveFinite(value, name);
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(value.toString());
  if (!match) throw new Error(`${name} must be a finite positive decimal`);
  const fraction = match[2] ?? "";
  const exponent = Number(match[3] ?? "0") - fraction.length;
  const digits = BigInt(`${match[1]}${fraction}`);
  return exponent >= 0
    ? { numerator: digits * (10n ** BigInt(exponent)), denominator: 1n }
    : { numerator: digits, denominator: 10n ** BigInt(-exponent) };
}

function addFraction(left: Fraction, right: Fraction): Fraction {
  return {
    numerator: (left.numerator * right.denominator) + (right.numerator * left.denominator),
    denominator: left.denominator * right.denominator,
  };
}

function multiplyFraction(left: Fraction, right: Fraction): Fraction {
  return { numerator: left.numerator * right.numerator, denominator: left.denominator * right.denominator };
}

function roundedSafeInteger(value: Fraction, name: string): number {
  const rounded = ((value.numerator * 2n) + value.denominator) / (value.denominator * 2n);
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${name} exceeds safe integer range`);
  return Number(rounded);
}

function safeCounter(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function completeModelUsage(value: unknown): value is ModelTokenUsage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return keys.length === 4
    && keys.join(",") === "cachedTokens,inputTokens,outputTokens,thinkingTokens"
    && safeCounter(record.inputTokens)
    && safeCounter(record.cachedTokens)
    && safeCounter(record.outputTokens)
    && safeCounter(record.thinkingTokens);
}

/** Prices provider-complete text usage. Fireworks completion tokens already include reasoning tokens. */
export function calculateModelUsageMicromxn(
  usage: ModelTokenUsage,
  rate: ProductionModelRate,
  mxnPerUsd: number,
): number {
  if (!completeModelUsage(usage)) throw new Error("complete model usage is required");
  if (usage.cachedTokens > usage.inputTokens) throw new Error("cachedTokens cannot exceed inputTokens");
  const inputRate = decimalFraction(rate.input, "input rate");
  const cachedRate = decimalFraction(rate.cached, "cached rate");
  const outputRate = decimalFraction(rate.output, "output rate");
  const fx = decimalFraction(mxnPerUsd, "mxnPerUsd");
  const tokenCost = addFraction(
    addFraction(
      { numerator: BigInt(usage.inputTokens - usage.cachedTokens) * inputRate.numerator, denominator: inputRate.denominator },
      { numerator: BigInt(usage.cachedTokens) * cachedRate.numerator, denominator: cachedRate.denominator },
    ),
    { numerator: BigInt(usage.outputTokens) * outputRate.numerator, denominator: outputRate.denominator },
  );
  return roundedSafeInteger(multiplyFraction(tokenCost, fx), "model cost");
}

export function calculateImageUsageMicromxn(
  usage: ImageUsage,
  rate: ProductionImageRate,
  mxnPerUsd: number,
): number {
  if (!usage || typeof usage !== "object" || !Number.isSafeInteger(usage.imageCount) || usage.imageCount <= 0) {
    throw new Error("imageCount must be a safe positive integer");
  }
  const perImage = decimalFraction(rate.image, "image rate");
  const fx = decimalFraction(mxnPerUsd, "mxnPerUsd");
  return roundedSafeInteger(multiplyFraction(
    { numerator: BigInt(usage.imageCount) * perImage.numerator * 1_000_000n, denominator: perImage.denominator },
    fx,
  ), "image cost");
}

/** Calculates all cost from the fixed rate card captured for the pilot. */
export function calculateModelCostMicros(
  usage: PilotModelUsage | IntentOnlyModelUsage,
  rateCard: ModelRateCard,
  mxnPerUsd: number,
): CostBreakdown {
  positiveFinite(mxnPerUsd, "mxnPerUsd");
  positiveFinite(rateCard.inputUsdPerMillion, "inputUsdPerMillion");
  positiveFinite(rateCard.cachedInputUsdPerMillion, "cachedInputUsdPerMillion");
  positiveFinite(rateCard.outputUsdPerMillion, "outputUsdPerMillion");
  positiveFinite(rateCard.thinkingUsdPerMillion, "thinkingUsdPerMillion");
  if (!rateCard.version.trim()) throw new Error("rate card version is required");

  if ("intent" in usage) {
    const cost = usageMicromxn(usage.intent, rateCard, mxnPerUsd);
    return { productionEquivalentCostMicromxn: cost, observedPilotCostMicromxn: cost };
  }

  const failed = (usage.failedCalls ?? []).reduce(
    (total, call) => total + usageMicromxn(call, rateCard, mxnPerUsd),
    0,
  );
  const productionEquivalentCostMicromxn = usageMicromxn(usage.creative, rateCard, mxnPerUsd)
    + usageMicromxn(usage.critic, rateCard, mxnPerUsd)
    + failed;
  const observedPilotCostMicromxn = productionEquivalentCostMicromxn
    + (usage.duplicateShadowCandidateFill
      ? usageMicromxn(usage.duplicateShadowCandidateFill, rateCard, mxnPerUsd)
      : 0);
  return { productionEquivalentCostMicromxn, observedPilotCostMicromxn };
}

const REQUIRED_RATE_CARD_ENV = [
  "OPENLEN_VISUAL_ENGINE_INPUT_USD_PER_MILLION",
  "OPENLEN_VISUAL_ENGINE_CACHED_INPUT_USD_PER_MILLION",
  "OPENLEN_VISUAL_ENGINE_OUTPUT_USD_PER_MILLION",
  "OPENLEN_VISUAL_ENGINE_THINKING_USD_PER_MILLION",
  "OPENLEN_VISUAL_ENGINE_MXN_PER_USD",
] as const;

type Environment = Readonly<Record<string, string | undefined>>;

function requiredNumber(env: Environment, key: (typeof REQUIRED_RATE_CARD_ENV)[number]): number {
  const value = env[key];
  if (value === undefined || value.trim() === "") throw new Error(`${key} is required`);
  const number = Number(value);
  positiveFinite(number, key);
  return number;
}

/** Reads pilot-only static rates. Quick does not call or depend on this parser. */
export function parsePilotRateCardFromEnv(env: Environment = process.env): PilotRateCardConfig {
  const version = env.OPENLEN_VISUAL_ENGINE_RATE_CARD_VERSION;
  if (!version?.trim()) throw new Error("OPENLEN_VISUAL_ENGINE_RATE_CARD_VERSION is required");
  return {
    version,
    inputUsdPerMillion: requiredNumber(env, "OPENLEN_VISUAL_ENGINE_INPUT_USD_PER_MILLION"),
    cachedInputUsdPerMillion: requiredNumber(env, "OPENLEN_VISUAL_ENGINE_CACHED_INPUT_USD_PER_MILLION"),
    outputUsdPerMillion: requiredNumber(env, "OPENLEN_VISUAL_ENGINE_OUTPUT_USD_PER_MILLION"),
    thinkingUsdPerMillion: requiredNumber(env, "OPENLEN_VISUAL_ENGINE_THINKING_USD_PER_MILLION"),
    mxnPerUsd: requiredNumber(env, "OPENLEN_VISUAL_ENGINE_MXN_PER_USD"),
  };
}
