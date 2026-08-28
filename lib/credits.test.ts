import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  selectLimit: vi.fn(),
  update: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  updateReturning: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ op: "and", conditions }),
  eq: (left: unknown, right: unknown) => ({ op: "eq", left, right }),
  isNull: (value: unknown) => ({ op: "is-null", value }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

vi.mock("@/lib/db", () => {
  const users = {
    id: "users.id",
    plan: "users.plan",
    credits: "users.credits",
    creditsRefreshedAt: "users.creditsRefreshedAt",
  };
  mocks.select.mockImplementation(() => ({
    from: () => ({
      where: () => ({ limit: mocks.selectLimit }),
    }),
  }));
  mocks.update.mockImplementation(() => ({
    set: (values: unknown) => {
      mocks.updateSet(values);
      return {
        where: (condition: unknown) => {
          mocks.updateWhere(condition);
          return { returning: mocks.updateReturning };
        },
      };
    },
  }));
  return { db: { select: mocks.select, update: mocks.update }, schema: { users } };
});

import {
  REFILL_MS,
  creditRate,
  creditRefillAt,
  creditsForUsage,
  getCreditState,
  noCreditsMessage,
  type CreditState,
} from "./credits";

const STATE: CreditState = {
  plan: "free",
  balance: 0,
  allotment: 20,
  refillsAt: new Date("2026-09-23T12:00:00.000Z"),
};

describe("credit refill contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is a rolling 30-day interval, not a calendar-month guess", () => {
    const refreshedAt = new Date("2026-08-24T12:00:00.000Z");

    expect(REFILL_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(creditRefillAt(refreshedAt).toISOString()).toBe(
      "2026-09-23T12:00:00.000Z",
    );
  });

  it("tells an existing-page user that the page is saved and names the UTC day", () => {
    expect(noCreditsMessage(STATE, "existing")).toBe(
      "No tienes créditos disponibles. Tu página está guardada y puedes publicarla ahora. Tus créditos vuelven el 23 de septiembre de 2026 (UTC).",
    );
  });

  it("does not claim /api/generate saved a page it never created", () => {
    expect(noCreditsMessage(STATE, "create")).toBe(
      "No tienes créditos disponibles. Aún no se creó una página nueva; tus páginas existentes siguen guardadas y puedes publicarlas. Tus créditos vuelven el 23 de septiembre de 2026 (UTC).",
    );
  });

  it("falls back honestly if an authenticated user row is unexpectedly missing", () => {
    expect(noCreditsMessage({ ...STATE, refillsAt: null }, "existing")).toBe(
      "No tienes créditos disponibles. Tu página está guardada y puedes publicarla ahora. Tus créditos se renuevan cada 30 días.",
    );
  });

  it("at the exact boundary atomically resets and anchors the next 30 days to now", async () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    vi.setSystemTime(now);
    mocks.selectLimit.mockResolvedValue([
      {
        plan: "free",
        credits: 2,
        refreshedAt: new Date(now.getTime() - REFILL_MS),
      },
    ]);
    mocks.updateReturning.mockResolvedValue([
      { plan: "free", credits: 20, refreshedAt: now },
    ]);

    await expect(getCreditState("u1")).resolves.toEqual({
      plan: "free",
      balance: 20,
      allotment: 20,
      refillsAt: new Date("2026-09-23T12:00:00.000Z"),
    });
    expect(mocks.updateReturning).toHaveBeenCalledOnce();
    expect(mocks.updateSet).toHaveBeenCalledWith({
      credits: 20,
      creditsRefreshedAt: now,
    });
  });

  it("one millisecond before the boundary keeps the persisted balance and anchor", async () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    const refreshedAt = new Date(now.getTime() - REFILL_MS + 1);
    vi.setSystemTime(now);
    mocks.selectLimit.mockResolvedValue([
      { plan: "free", credits: 2, refreshedAt },
    ]);

    await expect(getCreditState("u1")).resolves.toEqual({
      plan: "free",
      balance: 2,
      allotment: 20,
      refillsAt: new Date(now.getTime() + 1),
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("a concurrent refill loser re-reads instead of restoring credits spent after the winner", async () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    const expiredAt = new Date(now.getTime() - REFILL_MS);
    const winnerAnchor = new Date(now.getTime() + 5);
    vi.setSystemTime(now);
    mocks.selectLimit
      .mockResolvedValueOnce([
        { plan: "free", credits: 0, refreshedAt: expiredAt },
      ])
      .mockResolvedValueOnce([
        { plan: "free", credits: 19, refreshedAt: winnerAnchor },
      ]);
    // Another request changed the anchor first, so this compare-and-swap lost.
    mocks.updateReturning.mockResolvedValue([]);

    await expect(getCreditState("u1")).resolves.toEqual({
      plan: "free",
      balance: 19,
      allotment: 20,
      refillsAt: creditRefillAt(winnerAnchor),
    });
    expect(mocks.selectLimit).toHaveBeenCalledTimes(2);
    expect(mocks.updateReturning).toHaveBeenCalledOnce();
    expect(mocks.updateWhere).toHaveBeenCalledWith({
      op: "and",
      conditions: [
        { op: "eq", left: "users.id", right: "u1" },
        { op: "eq", left: "users.plan", right: "free" },
        {
          op: "eq",
          left: "users.creditsRefreshedAt",
          right: expiredAt,
        },
      ],
    });
  });

  it("the first refill compares a null anchor with IS NULL", async () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    vi.setSystemTime(now);
    mocks.selectLimit.mockResolvedValue([
      { plan: "free", credits: 0, refreshedAt: null },
    ]);
    mocks.updateReturning.mockResolvedValue([
      { plan: "free", credits: 20, refreshedAt: now },
    ]);

    await getCreditState("u1");

    expect(mocks.updateWhere).toHaveBeenCalledWith({
      op: "and",
      conditions: [
        { op: "eq", left: "users.id", right: "u1" },
        { op: "eq", left: "users.plan", right: "free" },
        { op: "is-null", value: "users.creditsRefreshedAt" },
      ],
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// LAS TARIFAS, FIJADAS A SU FUENTE.
//
// El 2026-08-28 se verificaron las tres de Fireworks contra la tabla canónica
// (docs.fireworks.ai/serverless/pricing, nivel Standard) y DOS estaban mal, en
// direcciones OPUESTAS: DeepSeek Flash cobraba de menos (0.14/0.28 contra
// 0.22/0.66) y Qwen de más (0.50/3.00 contra 0.40/1.60).
//
// Ninguna de las dos se veía. El redondeo a crédito tapa una tarifa equivocada
// en casi todos los turnos —de ahí que vivieran meses— y sólo asoma en uno
// concreto: crear una página costaba 1 crédito con la tarifa mala y cuesta 2
// con la buena. O sea que el plan FREE no daba 20 páginas al mes, daba 10.
//
// Esta prueba NO detecta que Fireworks suba el precio; eso no lo puede saber.
// Lo que impide es que los movamos NOSOTROS sin querer, y deja escrito de dónde
// salió cada número para que el siguiente que los revise sepa contra qué.
describe("las tarifas de cobro, contra su fuente", () => {
  const FIREWORKS = "docs.fireworks.ai/serverless/pricing · Standard · verificado 2026-08-28";

  it.each([
    ["deepseek-flash", 0.22, 0.66, FIREWORKS],
    ["deepseek-pro", 1.32, 3.96, FIREWORKS],
    ["qwen-vision", 0.40, 1.60, FIREWORKS],
  ] as const)("%s cobra lo que cuesta", (rate, input, output, fuente) => {
    expect(creditRate(rate), `fuente: ${fuente}`).toEqual({ input, output });
  });

  // EL PAPEL Y SU TARIFA, ATADOS. Es el mismo fallo que la guarda de
  // brain.test.ts: mover el modelo de un papel sin mover su tarifa esconde el
  // múltiplo entero. Aquí se fija que Pro cuesta 6x Flash, que es la razón por
  // la que el Agente tiene entrada propia.
  it("Pro cuesta 6x Flash — por eso no comparten tarifa", () => {
    const flash = creditRate("deepseek-flash");
    const pro = creditRate("deepseek-pro");
    expect(pro.input / flash.input).toBeCloseTo(6, 1);
    expect(pro.output / flash.output).toBeCloseTo(6, 1);
  });

  // Y Qwen NO es 10x, que es lo que decía el comentario que justificaba su
  // tarifa propia. Sigue mereciéndola —2.4x no es despreciable— pero por el
  // número correcto.
  it("Qwen es ~2.4x Flash en salida, no 10x", () => {
    expect(creditRate("qwen-vision").output / creditRate("deepseek-flash").output).toBeCloseTo(2.4, 1);
  });

  // LO QUE ESTA TABLA CUESTA EN CRÉDITOS, escrito para que un cambio de tarifa
  // enseñe su efecto en el usuario y no sólo en un decimal.
  it("crear una página cuesta 2 créditos, no 1", () => {
    expect(creditsForUsage(22_000, 9_000, "deepseek-flash")).toBe(2);
  });

  it("adjuntar una referencia cuesta 2, no los 4 que se cobraban", () => {
    expect(creditsForUsage(25_000, 6_000, "qwen-vision")).toBe(2);
  });

  it("un turno pesado del Agente en Pro cuesta 12", () => {
    expect(creditsForUsage(60_000, 8_000, "deepseek-pro")).toBe(12);
  });
});
