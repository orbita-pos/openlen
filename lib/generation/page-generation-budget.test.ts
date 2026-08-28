import { describe, expect, it } from "vitest";

import {
  FABLE_PRIORITY_RATES,
  FABLE_PRODUCTION_RATES,
  createPageGenerationBudget,
  parsePageBudgetConfigFromEnv,
} from "./page-generation-budget";

const CONFIG = {
  rateCardVersion: "fable-production/2026-08-12",
  mxnPerUsd: 20,
  targetMicromxn: 5_000_000,
  capMicromxn: 10_000_000,
};
const GLM = "accounts/fireworks/models/glm-5p2";
const QWEN = "accounts/fireworks/models/qwen3p7-plus";
const DEEPSEEK = "accounts/fireworks/models/deepseek-v4-flash-0731";

describe("page generation budget", () => {
  it("exposes the conservative multi-model and image rate card", () => {
    expect(FABLE_PRODUCTION_RATES).toEqual({
      "accounts/fireworks/models/deepseek-v4-flash-0731": { input: .14, cached: .028, output: .28 },
      "accounts/fireworks/models/glm-5p2": { input: 1.40, cached: .26, output: 4.40 },
      "accounts/fireworks/models/qwen3p7-plus": { input: .50, cached: .10, output: 3.00 },
      "gemini-2.5-flash-image": { image: .039 },
    });
    expect(FABLE_PRIORITY_RATES).toEqual({
      "accounts/fireworks/models/deepseek-v4-flash-0731": { input: .175, cached: .035, output: .35 },
    });
  });

  it("reserves and settles DeepSeek Priority at the official tier rate", () => {
    const budget = createPageGenerationBudget(CONFIG);
    const lease = budget.reserve({
      kind: "model",
      modelId: DEEPSEEK,
      serviceTier: "priority",
      maxInputTokens: 10_000,
      maxOutputTokens: 2_000,
    });
    expect(lease.ok).toBe(true);
    expect(budget.snapshot().reservedMicromxn).toBe(49_000);
    if (!lease.ok) throw new Error("expected lease");
    budget.complete(lease.leaseId, { inputTokens: 8_000, cachedTokens: 2_000, outputTokens: 1_000, thinkingTokens: 400 });
    expect(budget.snapshot().modelUsage).toEqual([{
      modelId: DEEPSEEK,
      serviceTier: "priority",
      inputTokens: 8_000,
      cachedTokens: 2_000,
      outputTokens: 1_000,
      thinkingTokens: 400,
      costMicromxn: 29_400,
    }]);
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
    expect(budget.snapshot()).toMatchObject({ actualMicromxn: 266_400, reservedMicromxn: 0 });
    expect(budget.snapshot().modelUsage).toEqual([{
      modelId: GLM,
      inputTokens: 8_000,
      cachedTokens: 2_000,
      outputTokens: 1_000,
      thinkingTokens: 400,
      costMicromxn: 266_400,
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
    expect(parsePageBudgetConfigFromEnv(valid)).toMatchObject({ mxnPerUsd: 20, targetMicromxn: 5_000_000, capMicromxn: 10_000_000 });
    for (const [key, value] of Object.entries({
      OPENLEN_FABLE_RATE_CARD_VERSION: " ",
      OPENLEN_FABLE_MXN_PER_USD: "NaN",
      OPENLEN_FABLE_PAGE_TARGET_MICROMXN: "4999999",
      OPENLEN_FABLE_PAGE_CAP_MICROMXN: "9000000",
    })) {
      expect(() => parsePageBudgetConfigFromEnv({ ...valid, [key]: value })).toThrow();
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

// ─── Los nombres nuevos, y el viejo como respaldo ────────────────────────────
//
// `OPENLEN_FABLE_*` mentía: el presupuesto es de una PÁGINA, no de un proveedor
// — la tarifa se aplica igual escriba DeepSeek, GLM o Qwen. Jesús pidió quitar
// ese nombre el 2026-08-27.
//
// El respaldo NO es cortesía: las variables viejas están puestas en el box de
// producción. Un renombrado a secas dejaría la ruta que las lee lanzando en el
// primer request tras desplegar — un fallo invisible en local, que sólo sale en
// producción y sólo al usar la función.

describe("el presupuesto y sus nombres", () => {
  const NUEVAS = {
    OPENLEN_PAGE_RATE_CARD_VERSION: "fable-production/2026-08-12",
    OPENLEN_PAGE_MXN_PER_USD: "20",
    OPENLEN_PAGE_TARGET_MICROMXN: "5000000",
    OPENLEN_PAGE_CAP_MICROMXN: "10000000",
  };
  const VIEJAS = {
    OPENLEN_FABLE_RATE_CARD_VERSION: "fable-production/2026-08-12",
    OPENLEN_FABLE_MXN_PER_USD: "20",
    OPENLEN_FABLE_PAGE_TARGET_MICROMXN: "5000000",
    OPENLEN_FABLE_PAGE_CAP_MICROMXN: "10000000",
  };
  const ESPERADO = { mxnPerUsd: 20, targetMicromxn: 5_000_000, capMicromxn: 10_000_000 };

  it("lee los nombres nuevos", () => {
    expect(parsePageBudgetConfigFromEnv(NUEVAS)).toMatchObject(ESPERADO);
  });

  it("y los VIEJOS, que son los que hay en el box ahora mismo", () => {
    expect(
      parsePageBudgetConfigFromEnv(VIEJAS),
      "sin respaldo, el primer despliegue rompe la ruta que lo lee",
    ).toMatchObject(ESPERADO);
  });

  it("el nuevo gana cuando están los dos", () => {
    expect(
      parsePageBudgetConfigFromEnv({ ...VIEJAS, ...NUEVAS, OPENLEN_PAGE_MXN_PER_USD: "21" }),
    ).toMatchObject({ mxnPerUsd: 21 });
  });

  /** El error nombra el que el operador tiene que PONER, no el que ya no
   *  existe: un mensaje que pide una variable retirada manda a buscar el sitio
   *  equivocado. */
  it("y sin ninguna, el error pide el nombre NUEVO", () => {
    expect(() => parsePageBudgetConfigFromEnv({})).toThrow(
      "OPENLEN_PAGE_RATE_CARD_VERSION is required",
    );
    expect(() => parsePageBudgetConfigFromEnv({ ...NUEVAS, OPENLEN_PAGE_MXN_PER_USD: "" })).toThrow(
      "OPENLEN_PAGE_MXN_PER_USD is required",
    );
  });

  /** Pero un valor MALO se reprocha por el nombre que de verdad se leyó — si el
   *  box tiene el viejo con basura, decirle que arregle el nuevo lo manda a
   *  editar una variable que no existe. */
  it("un valor inválido nombra la variable que se leyó", () => {
    expect(() =>
      parsePageBudgetConfigFromEnv({ ...VIEJAS, OPENLEN_FABLE_MXN_PER_USD: "NaN" }),
    ).toThrow("OPENLEN_FABLE_MXN_PER_USD must be finite");
  });
});
