import { describe, expect, it } from "vitest";

import { creditRate } from "@/lib/credits";

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
// ⚰️ Esta constante se llamaba QWEN y apuntaba a `qwen3p7-plus`. Ese modelo
// salio del repo el 2026-09-13 (nadie lo corria desde que la vision paso a v4.1
// Flash), y un modelo muerto como sujeto de prueba es un sujeto que ya no dice
// nada del sistema. Se nombra el PAPEL, no el proveedor.
const VISION = "accounts/fireworks/models/deepseek-v4p1-flash";
const DEEPSEEK = "accounts/fireworks/models/deepseek-v4-flash-0731";

describe("page generation budget", () => {
  it("exposes the conservative multi-model and image rate card", () => {
    expect(FABLE_PRODUCTION_RATES).toEqual({
      "accounts/fireworks/models/deepseek-v4-flash-0731": { input: .22, cached: .007, output: .66 },
      "accounts/fireworks/models/glm-5p2": { input: 1.40, cached: .26, output: 4.40 },
      "accounts/fireworks/models/deepseek-v4p1-flash": { input: .22, cached: .007, output: .66 },
      "gemini-2.5-flash-image": { image: .039 },
    });
    expect(FABLE_PRIORITY_RATES).toEqual({
      "accounts/fireworks/models/deepseek-v4-flash-0731": { input: .275, cached: .00875, output: .825 },
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
    // 10.000 x .275 + 2.000 x .825 = 0,0044 USD; x20 MXN/USD = 88.000 micromxn.
    // Eran 49.000 con la tarjeta pre-correccion del 2026-08-28.
    expect(budget.snapshot().reservedMicromxn).toBe(88_000);
    if (!lease.ok) throw new Error("expected lease");
    budget.complete(lease.leaseId, { inputTokens: 8_000, cachedTokens: 2_000, outputTokens: 1_000, thinkingTokens: 400 });
    expect(budget.snapshot().modelUsage).toEqual([{
      modelId: DEEPSEEK,
      serviceTier: "priority",
      inputTokens: 8_000,
      cachedTokens: 2_000,
      outputTokens: 1_000,
      thinkingTokens: 400,
      // (8.000-2.000) x .275 + 2.000 x .00875 + 1.000 x .825 = 0,0024925 USD;
      // x20 = 49.850 micromxn. Eran 29.400 con la tarjeta pre-correccion.
      costMicromxn: 49_850,
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
    const lease = budget.reserve({ kind: "model", modelId: VISION, maxInputTokens: 100_000, maxOutputTokens: 10_000 });
    if (!lease.ok) throw new Error("expected lease");
    expect(() => budget.complete(lease.leaseId, { inputTokens: 2 } as never)).toThrow("complete model usage");
    // 100.000 x .22 + 10.000 x .66 = 0,0286 USD; x20 = 572.000 micromxn.
    expect(budget.snapshot()).toMatchObject({ actualMicromxn: 572_000, reservedMicromxn: 0 });
  });

  // 🔴 SE RESERVA HASTA QUE EL GUARDIA DIGA QUE NO, en vez de clavar «dos».
  //
  // Cuantas llamadas caben depende del PRECIO, asi que un numero fijo obliga a
  // re-tocar esta prueba en cada cambio de tarifa — y si alguien la re-toca sin
  // pensar, la deja verde sin ejercitar nada. Paso el 2026-09-13 al corregir la
  // tarjeta: qwen bajo de 3.00 a 1.60 en salida, cabian TRES, y cambiar el 2
  // por un 3 habria dejado una prueba en la que ninguna reserva se rechaza —
  // o sea una prueba de «nunca se pasa del tope» que nunca llega al tope.
  //
  // Lo que se afirma ahora es la PROPIEDAD, no la aritmetica: el tope se
  // alcanza, a partir de ahi se rechaza, y nunca se pasa.
  it("never overspends under interleaved concurrent reservations", () => {
    const budget = createPageGenerationBudget(CONFIG);
    const INTENTOS = 20;
    const calls = Array.from({ length: INTENTOS }, () =>
      budget.reserve({ kind: "model" as const, modelId: VISION, maxInputTokens: 10_000, maxOutputTokens: 65_000 }),
    );
    const aceptadas = calls.filter((call) => call.ok);
    // Alguna entra...
    expect(aceptadas.length).toBeGreaterThan(0);
    // ...y el tope SE ALCANZA de verdad: si no, esto no medira nada.
    expect(aceptadas.length).toBeLessThan(INTENTOS);
    // A partir del primer rechazo, todo se rechaza igual.
    expect(calls.at(-1)).toEqual({ ok: false, code: "budget_exceeded" });
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
      rates: { ...FABLE_PRODUCTION_RATES, [VISION]: { input: .01, cached: .01, output: .01 } },
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

// ─── LA GUARDA CONTRA LA DERIVA ─────────────────────────────────────────────
//
// 🔴 POR QUE EXISTE. Esta tarjeta y `lib/credits.ts` describen LO MISMO —lo que
// Fireworks cobra por millon de tokens— y llevaban desde el 2026-08-28
// diciendo cosas distintas. Ese dia se cuadro la tabla de creditos contra la
// factura real y se corrigieron dos modelos; esta tarjeta no se movio, mientras
// el comentario de alla seguia afirmando «misma tarjeta que
// FABLE_PRODUCTION_RATES».
//
// Nadie se entero porque ninguna de las dos sabe de la otra. Ahora si: una
// prueba que se pone roja el dia que se separen. Es la forma que ya usa
// `lib/ai/tarifas-eval.test.ts` para el arnes de evals, aqui para el guardia de
// presupuesto.
//
// La tarjeta NO importa `lib/credits.ts` en produccion a proposito: eso
// arrastraria `lib/db` dentro de un modulo de calculo puro. Quien las ata es
// esta prueba, no una dependencia.
describe("la tarjeta no puede separarse de la tabla con la que se cobra", () => {
  it.each([
    ["accounts/fireworks/models/deepseek-v4-flash-0731", "deepseek-flash"],
    ["accounts/fireworks/models/deepseek-v4p1-flash", "deepseek-flash"],
  ] as const)("%s cuesta lo mismo aqui que en credits.ts (%s)", (modelId, tarifa) => {
    const cobro = creditRate(tarifa);
    const tarjeta = FABLE_PRODUCTION_RATES[modelId];
    expect(tarjeta, `falta la fila de ${modelId}`).toBeDefined();
    expect({ input: tarjeta.input, output: tarjeta.output, cached: tarjeta.cached }).toEqual({
      input: cobro.input,
      output: cobro.output,
      cached: cobro.cached,
    });
  });

  // Priority es la estandar por 1,25. Se comprueba la RELACION y no las cifras:
  // asi corregir la estandar obliga a mover la priority, que es exactamente lo
  // que no paso la vez anterior — quedo siendo un 25% mas que un precio muerto.
  it("priority es exactamente 1,25x la estandar del mismo modelo", () => {
    const M = "accounts/fireworks/models/deepseek-v4-flash-0731";
    const e = FABLE_PRODUCTION_RATES[M];
    const p = FABLE_PRIORITY_RATES[M];
    expect(p.input).toBeCloseTo(e.input * 1.25, 6);
    expect(p.cached).toBeCloseTo(e.cached * 1.25, 6);
    expect(p.output).toBeCloseTo(e.output * 1.25, 6);
  });
});
