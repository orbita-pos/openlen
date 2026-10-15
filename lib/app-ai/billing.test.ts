import { describe, expect, it } from "vitest";

import type { CreditRate } from "@/lib/credits";

import { actualCenticredits, estimateTokens, streamedCenticredits, worstCaseCenticredits } from "./billing";
import { appAiEnabledIn } from "./enabled";
import { APP_AI_LIMITS, freeDailyCapCenticredits, monthlyCap } from "./limits";

// The reasoner's rate today (lib/ai/tarifas.ts): $0.30 in, $1.20 out, $0.006
// cached, per million. 1 centicredit = $0.0001.
const RATE = "deepseek-flash-4p1" as CreditRate;

describe("billing", () => {
  it("estimates tokens on the high side", () => {
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(1)).toBe(1);
    expect(estimateTokens(1500)).toBe(500);
  });

  it("the worst case: estimated input plus all of max_tokens, no cache", () => {
    // 500 × 0.30 + 2048 × 1.20 = 2607.6 µ$ → 26.076 → 27 centicredits.
    expect(worstCaseCenticredits({ inputBytes: 1500, maxTokens: 2048, rate: RATE })).toBe(27);
  });

  it("the real cost counts the cache", () => {
    // 100 × 0.30 + 500 × 0.006 + 80 × 1.20 = 129 µ$ → 1.29 → 2.
    expect(actualCenticredits({ inputTokens: 600, outputTokens: 80, cachedTokens: 500 }, RATE)).toBe(2);
  });

  it("what was streamed when the usage never came", () => {
    // 500 × 0.30 + 100 × 1.20 = 270 µ$ → 2.7 → 3.
    expect(streamedCenticredits({ inputBytes: 1500, outputChars: 300, rate: RATE })).toBe(3);
  });
});

describe("limits", () => {
  it("the default cap is 25 % of the plan", () => {
    expect(monthlyCap(null, 2_000)).toBe(500); // free: 5 credits
    expect(monthlyCap(null, 30_000)).toBe(7_500); // pro: 75
    expect(monthlyCap(null, 80_000)).toBe(20_000); // max: 200
    expect(monthlyCap(null, 500_000)).toBe(125_000); // ultra: 1,250
  });

  it("an explicit cap goes from 0 to the whole plan", () => {
    expect(monthlyCap(0, 30_000)).toBe(0);
    expect(monthlyCap(1_234, 30_000)).toBe(1_234);
    expect(monthlyCap(99_999, 30_000)).toBe(30_000);
    expect(monthlyCap(-5, 30_000)).toBe(0);
  });

  it("the plan limits are the spec's", () => {
    expect(APP_AI_LIMITS).toEqual({
      free: { requestsPerMinute: 20, concurrent: 2 },
      pro: { requestsPerMinute: 120, concurrent: 10 },
      max: { requestsPerMinute: 240, concurrent: 20 },
      ultra: { requestsPerMinute: 600, concurrent: 50 },
    });
  });

  it("the free daily pool: $2 by default, in centicredits", () => {
    expect(freeDailyCapCenticredits({})).toBe(20_000);
    expect(freeDailyCapCenticredits({ OPENLEN_APP_AI_FREE_DAILY_USD: "0.5" })).toBe(5_000);
    expect(freeDailyCapCenticredits({ OPENLEN_APP_AI_FREE_DAILY_USD: "0" })).toBe(0);
    expect(freeDailyCapCenticredits({ OPENLEN_APP_AI_FREE_DAILY_USD: "abc" })).toBe(20_000);
    expect(freeDailyCapCenticredits({ OPENLEN_APP_AI_FREE_DAILY_USD: "-1" })).toBe(20_000);
  });
});

describe("appAiEnabledIn", () => {
  const FUNCTIONS = { OPENLEN_FUNCTIONS_ENGINE: "local", PAGES_DATABASE_URL: "postgres://x", PAGES_AUTHENTICATOR_PASSWORD: "y" };
  it("is on with the Edge Functions, and only then", () => {
    expect(appAiEnabledIn(FUNCTIONS)).toBe(true);
    expect(appAiEnabledIn({})).toBe(false);
  });
  it("OPENLEN_APP_AI=0 turns it off", () => {
    expect(appAiEnabledIn({ ...FUNCTIONS, OPENLEN_APP_AI: "0" })).toBe(false);
    expect(appAiEnabledIn({ ...FUNCTIONS, OPENLEN_APP_AI: "1" })).toBe(true);
  });
});
