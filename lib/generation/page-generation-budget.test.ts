import { describe, expect, it } from "vitest";

import {
  FABLE_PRODUCTION_RATES,
  createPageGenerationBudget,
  parseFablePageBudgetConfigFromEnv,
} from "./page-generation-budget";

const CONFIG = {
  rateCardVersion: "fable-production/2026-08-12",
  mxnPerUsd: 20,
  targetMicromxn: 5_000_000,
  capMicromxn: 10_000_000,
};
const GLM = "accounts/fireworks/models/glm-5p2";
const QWEN = "accounts/fireworks/models/qwen3p7-plus";

describe("page generation budget", () => {
  it("exposes the conservative multi-model and image rate card", () => {
    expect(FABLE_PRODUCTION_RATES).toEqual({
      "accounts/fireworks/models/deepseek-v4-flash": { input: .14, cached: .028, output: .28 },
      "accounts/fireworks/models/glm-5p2": { input: 1.40, cached: .14, output: 4.40 },
      "accounts/fireworks/models/qwen3p7-plus": { input: .50, cached: .10, output: 3.00 },
      "gemini-2.5-flash-image": { image: .039 },
    });
  });

  it("reports the 5 MXN target and exact 10 MXN hard cap using only redacted allowlisted fields", () => {
    const snapshot = createPageGenerationBudget(CONFIG).snapshot();
    expect(snapshot).toEqual({
      rateCardVersion: "fable-production/2026-08-12",
      targetMicromxn: 5_000_000,
      capMicromxn: 10_000_000,
      actualMicromxn: 0,
      reservedMicromxn: 0,
      modelUsage: [],
      imageUsage: [],
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/prompt|response|body|html|credential|user/i);
  });

  it("reserves worst-case model cost before a call and replaces it with actual failed-call cost", () => {
    const budget = createPageGenerationBudget(CONFIG);
    const lease = budget.reserve({ kind: "model", modelId: GLM, maxInputTokens: 10_000, maxOutputTokens: 2_000 });
    expect(lease.ok).toBe(true);
    expect(budget.snapshot().reservedMicromxn).toBe(456_000);
    if (!lease.ok) throw new Error("expected lease");
    budget.complete(lease.leaseId, { inputTokens: 8_000, cachedTokens: 2_000, outputTokens: 1_000, thinkingTokens: 400 });
    expect(budget.snapshot()).toMatchObject({ actualMicromxn: 261_600, reservedMicromxn: 0 });
    expect(budget.snapshot().modelUsage).toEqual([{
      modelId: GLM,
      inputTokens: 8_000,
      cachedTokens: 2_000,
      outputTokens: 1_000,
      thinkingTokens: 400,
      costMicromxn: 261_600,
    }]);
  });

  it("counts retry attempts as independent reservations", () => {
    const budget = createPageGenerationBudget(CONFIG);
    const first = budget.reserve({ kind: "model", modelId: GLM, maxInputTokens: 10_000, maxOutputTokens: 70_000 });
    expect(first.ok).toBe(true);
    const retryWhileFirstOutstanding = budget.reserve({ kind: "model", modelId: GLM, maxInputTokens: 10_000, maxOutputTokens: 70_000 });
    expect(retryWhileFirstOutstanding).toEqual({ ok: false, code: "budget_exceeded" });
    if (!first.ok) throw new Error("expected lease");
    budget.complete(first.leaseId, { inputTokens: 0, cachedTokens: 0, outputTokens: 0, thinkingTokens: 0 });
    expect(budget.reserve({ kind: "model", modelId: GLM, maxInputTokens: 10_000, maxOutputTokens: 70_000 }).ok).toBe(true);
  });

  it("prices generated images by count and keeps Gemini image-only", () => {
    const budget = createPageGenerationBudget(CONFIG);
    const lease = budget.reserve({ kind: "image", modelId: "gemini-2.5-flash-image", imageCount: 3 });
    expect(lease.ok).toBe(true);
    expect(budget.snapshot().reservedMicromxn).toBe(2_340_000);
    if (!lease.ok) throw new Error("expected lease");
    budget.complete(lease.leaseId, { imageCount: 2 });
    expect(budget.snapshot().imageUsage).toEqual([{
      modelId: "gemini-2.5-flash-image", imageCount: 2, costMicromxn: 1_560_000,
    }]);
    expect(() => budget.reserve({ kind: "image", modelId: GLM, imageCount: 1 })).toThrow("unknown image model");
  });

  it("fails closed without releasing cost when provider usage is incomplete", () => {
    const budget = createPageGenerationBudget(CONFIG);
    const lease = budget.reserve({ kind: "model", modelId: QWEN, maxInputTokens: 100_000, maxOutputTokens: 10_000 });
    if (!lease.ok) throw new Error("expected lease");
    expect(() => budget.complete(lease.leaseId, { inputTokens: 2 } as never)).toThrow("complete model usage");
    expect(budget.snapshot()).toMatchObject({ actualMicromxn: 1_600_000, reservedMicromxn: 0 });
  });

  it("never overspends under interleaved concurrent reservations", () => {
    const budget = createPageGenerationBudget(CONFIG);
    const calls = Array.from({ length: 3 }, () => budget.reserve({ kind: "model" as const, modelId: QWEN, maxInputTokens: 10_000, maxOutputTokens: 65_000 }));
    expect(calls.filter((call) => call.ok)).toHaveLength(2);
    expect(calls[2]).toEqual({ ok: false, code: "budget_exceeded" });
    expect(budget.snapshot().actualMicromxn + budget.snapshot().reservedMicromxn).toBeLessThanOrEqual(10_000_000);
  });

  it("fails closed for absent, invalid, or non-exact enabled configuration", () => {
    const valid = {
      OPENLEN_FABLE_RATE_CARD_VERSION: "fable-production/2026-08-12",
      OPENLEN_FABLE_MXN_PER_USD: "20",
      OPENLEN_FABLE_PAGE_TARGET_MICROMXN: "5000000",
      OPENLEN_FABLE_PAGE_CAP_MICROMXN: "10000000",
    };
    expect(parseFablePageBudgetConfigFromEnv(valid)).toMatchObject({ mxnPerUsd: 20, targetMicromxn: 5_000_000, capMicromxn: 10_000_000 });
    for (const [key, value] of Object.entries({
      OPENLEN_FABLE_RATE_CARD_VERSION: " ",
      OPENLEN_FABLE_MXN_PER_USD: "NaN",
      OPENLEN_FABLE_PAGE_TARGET_MICROMXN: "4999999",
      OPENLEN_FABLE_PAGE_CAP_MICROMXN: "9000000",
    })) {
      expect(() => parseFablePageBudgetConfigFromEnv({ ...valid, [key]: value })).toThrow();
    }
    expect(() => createPageGenerationBudget({
      ...CONFIG,
      rates: { ...FABLE_PRODUCTION_RATES, [GLM]: { input: 1.40, cached: .14, output: Number.NaN } },
    } as never)).toThrow("production rates are fixed");
  });

  it("rejects caller-supplied rate maps that are subvalued or contain extra models", () => {
    expect(() => createPageGenerationBudget({
      ...CONFIG,
      rates: { ...FABLE_PRODUCTION_RATES, [QWEN]: { input: .01, cached: .01, output: .01 } },
    } as never)).toThrow("production rates are fixed");
    expect(() => createPageGenerationBudget({
      ...CONFIG,
      rates: { ...FABLE_PRODUCTION_RATES, "unapproved-model": { input: .01, cached: .01, output: .01 } },
    } as never)).toThrow("production rates are fixed");
  });

  it.each([
    [4_999_999, 10_000_000],
    [5_000_001, 10_000_000],
    [5_000_000, 9_000_000],
  ])("rejects non-exact page target %i or cap %i", (targetMicromxn, capMicromxn) => {
    expect(() => createPageGenerationBudget({ ...CONFIG, targetMicromxn, capMicromxn }))
      .toThrow("exactly 5000000/10000000");
  });
});
