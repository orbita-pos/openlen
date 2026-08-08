import { describe, expect, it } from "vitest";
import { calculateModelCostMicros, parsePilotRateCardFromEnv } from "./model-cost";

const RATE_CARD = {
  version: "gemini-test/2026-08-07",
  inputUsdPerMillion: 2,
  cachedInputUsdPerMillion: 0.5,
  outputUsdPerMillion: 8,
  thinkingUsdPerMillion: 1,
};

describe("calculateModelCostMicros", () => {
  it("uses integer micro-MXN math, billable input minus cache, and failed-call usage", () => {
    const result = calculateModelCostMicros({
      creative: { inputTokens: 100, cachedTokens: 25, outputTokens: 10, thinkingTokens: 5 },
      critic: { inputTokens: 50, cachedTokens: 0, outputTokens: 5, thinkingTokens: 0 },
      failedCalls: [{ inputTokens: 40, cachedTokens: 100, outputTokens: 0, thinkingTokens: 2 }],
      duplicateShadowCandidateFill: { inputTokens: 25, cachedTokens: 0, outputTokens: 3, thinkingTokens: 0 },
    }, RATE_CARD, 20);

    expect(result).toEqual({ productionEquivalentCostMicromxn: 8790, observedPilotCostMicromxn: 10270 });
  });

  it("handles zero usage and rejects invalid explicit FX", () => {
    expect(calculateModelCostMicros({
      creative: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, thinkingTokens: 0 },
      critic: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, thinkingTokens: 0 },
    }, RATE_CARD, 20)).toEqual({ productionEquivalentCostMicromxn: 0, observedPilotCostMicromxn: 0 });
    expect(() => calculateModelCostMicros({ creative: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, thinkingTokens: 0 }, critic: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, thinkingTokens: 0 } }, RATE_CARD, 0)).toThrow("mxnPerUsd");
  });

  it("prices an intent-only preflight through the shared frozen rate-card math", () => {
    expect(calculateModelCostMicros({
      intent: { inputTokens: 7_500, cachedTokens: 1_875, outputTokens: 750, thinkingTokens: 375 },
    }, RATE_CARD, 20)).toEqual({
      productionEquivalentCostMicromxn: 371_250,
      observedPilotCostMicromxn: 371_250,
    });
  });
});

describe("parsePilotRateCardFromEnv", () => {
  it("fails closed for missing, non-finite, zero, or negative required values", () => {
    const valid = {
      OPENLEN_VISUAL_ENGINE_RATE_CARD_VERSION: "rate-card/1",
      OPENLEN_VISUAL_ENGINE_INPUT_USD_PER_MILLION: "1",
      OPENLEN_VISUAL_ENGINE_CACHED_INPUT_USD_PER_MILLION: "0.5",
      OPENLEN_VISUAL_ENGINE_OUTPUT_USD_PER_MILLION: "2",
      OPENLEN_VISUAL_ENGINE_THINKING_USD_PER_MILLION: "3",
      OPENLEN_VISUAL_ENGINE_MXN_PER_USD: "20",
    };
    expect(parsePilotRateCardFromEnv(valid)).toMatchObject({ version: "rate-card/1", mxnPerUsd: 20 });
    for (const [key, value] of Object.entries({
      OPENLEN_VISUAL_ENGINE_INPUT_USD_PER_MILLION: undefined,
      OPENLEN_VISUAL_ENGINE_CACHED_INPUT_USD_PER_MILLION: "NaN",
      OPENLEN_VISUAL_ENGINE_OUTPUT_USD_PER_MILLION: "0",
      OPENLEN_VISUAL_ENGINE_THINKING_USD_PER_MILLION: "-1",
      OPENLEN_VISUAL_ENGINE_MXN_PER_USD: "Infinity",
    })) {
      expect(() => parsePilotRateCardFromEnv({ ...valid, [key]: value })).toThrow();
    }
  });
});
