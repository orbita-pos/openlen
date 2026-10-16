import { describe, expect, it } from "vitest";

import { MODEL_POLICY } from "@/lib/generation/model-policy";

import { TOKEN_COST_RATES, peakAwareRate, tokenCostMicroUsd, unitCostMicroUsd, type TokenCostRate } from "./cost-rates";

const FLASH = "accounts/fireworks/models/deepseek-v4p1-flash";
const AT = new Date("2026-10-16T15:00:00Z");

describe("tokenCostMicroUsd", () => {
  it("prices Fireworks V4.1 Flash exactly like the billing rate", () => {
    expect(
      tokenCostMicroUsd({ provider: "fireworks", model: FLASH, inputTokens: 1_000_000, cachedTokens: 900_000, outputTokens: 20_000, at: AT }),
    ).toBe(59_400);
  });

  it("uses the peak prices inside the peak hours", () => {
    const rate: TokenCostRate = {
      input: 0.15,
      cached: 0.003,
      output: 0.6,
      peak: { input: 0.3, cached: 0.006, output: 1.2, hoursUtc: [1, 2, 3, 6, 7, 8, 9], isoDays: [1, 2, 3, 4, 5] },
    };
    // Monday 03:00 UTC: peak. Saturday 03:00 UTC: weekend, so off-peak.
    expect(peakAwareRate(rate, new Date("2026-10-12T03:00:00Z"))).toEqual({ input: 0.3, cached: 0.006, output: 1.2 });
    expect(peakAwareRate(rate, new Date("2026-10-17T03:00:00Z"))).toEqual({ input: 0.15, cached: 0.003, output: 0.6 });
    // Monday 04:00 UTC: the peak band 01-04 is over.
    expect(peakAwareRate(rate, new Date("2026-10-12T04:00:00Z"))).toEqual({ input: 0.15, cached: 0.003, output: 0.6 });
  });

  it("clamps impossible cached counts", () => {
    const base = { provider: "fireworks" as const, model: FLASH, inputTokens: 1_000, outputTokens: 0, at: AT };
    // Negative or NaN cached → nothing cached: 1 000 × $0.30/M = 300 micro-USD.
    expect(tokenCostMicroUsd({ ...base, cachedTokens: -50 })).toBe(300);
    expect(tokenCostMicroUsd({ ...base, cachedTokens: Number.NaN })).toBe(300);
    // More cached than input → all of the input is cached: 1 000 × $0.006/M = 6.
    expect(tokenCostMicroUsd({ ...base, cachedTokens: 5_000 })).toBe(6);
  });

  it("returns null for an unknown model, never 0", () => {
    expect(
      tokenCostMicroUsd({ provider: "fireworks", model: "accounts/fireworks/models/nope", inputTokens: 10, cachedTokens: 0, outputTokens: 10, at: AT }),
    ).toBeNull();
  });

  it("every model of the policy has a cost rate", () => {
    for (const policy of Object.values(MODEL_POLICY)) {
      expect(TOKEN_COST_RATES[`fireworks/${policy.modelId}`], policy.modelId).toBeDefined();
    }
  });
});

describe("unitCostMicroUsd", () => {
  it("unit costs", () => {
    expect(unitCostMicroUsd({ provider: "openai", model: "gpt-image-2", images: 1 })).toBe(53_000);
    expect(unitCostMicroUsd({ provider: "openai", model: "gpt-live-1", seconds: 90 })).toBe(75_000);
    expect(unitCostMicroUsd({ provider: "exa", model: "search", queries: 2 })).toBe(30_000);
  });

  it("returns null when the unit has no known price", () => {
    expect(unitCostMicroUsd({ provider: "openai", model: "gpt-image-9", images: 1 })).toBeNull();
    expect(unitCostMicroUsd({ provider: "exa", model: "search" })).toBeNull();
  });
});
