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

export interface PilotModelUsage {
  creative: ModelTokenUsage;
  critic: ModelTokenUsage;
  failedCalls?: readonly ModelTokenUsage[];
  duplicateShadowCandidateFill?: ModelTokenUsage;
}

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

/** Calculates all cost from the fixed rate card captured for the pilot. */
export function calculateModelCostMicros(
  usage: PilotModelUsage,
  rateCard: ModelRateCard,
  mxnPerUsd: number,
): CostBreakdown {
  positiveFinite(mxnPerUsd, "mxnPerUsd");
  positiveFinite(rateCard.inputUsdPerMillion, "inputUsdPerMillion");
  positiveFinite(rateCard.cachedInputUsdPerMillion, "cachedInputUsdPerMillion");
  positiveFinite(rateCard.outputUsdPerMillion, "outputUsdPerMillion");
  positiveFinite(rateCard.thinkingUsdPerMillion, "thinkingUsdPerMillion");
  if (!rateCard.version.trim()) throw new Error("rate card version is required");

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
