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
  CENTICREDITOS_POR_CREDITO,
  CREDITS_BY_PLAN,
  REFILL_MS,
  creditRate,
  formatCredits,
  creditRefillAt,
  creditsForUsage,
  getCreditState,
  noCreditsMessage,
  refundCredits,
  type CreditState,
} from "./credits";

const STATE: CreditState = {
  plan: "free",
  balance: 0,
  allotment: CREDITS_BY_PLAN.free,
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
      "Te quedaste sin créditos. Tu página está guardada y puedes publicarla ahora. Vuelven el 23 de septiembre de 2026 (UTC) — o pásate a Pro para seguir hoy.",
    );
  });

  it("does not claim /api/generate saved a page it never created", () => {
    expect(noCreditsMessage(STATE, "create")).toBe(
      "Te quedaste sin créditos. Aún no se creó una página nueva; tus páginas existentes siguen guardadas y puedes publicarlas. Vuelven el 23 de septiembre de 2026 (UTC) — o pásate a Pro para seguir hoy.",
    );
  });

  it("falls back honestly if an authenticated user row is unexpectedly missing", () => {
    expect(noCreditsMessage({ ...STATE, refillsAt: null }, "existing")).toBe(
      "Te quedaste sin créditos. Tu página está guardada y puedes publicarla ahora. Se renuevan cada 30 días — o pásate a Pro para seguir hoy.",
    );
  });

  // LA PARTE QUE NO PUEDE PERDERSE en un retoque de redacción. Las tres de
  // arriba fijan la cadena entera, así que cualquier cambio las rompe y hay
  // que mirarlas; ésta dice QUÉ es lo que no se puede caer.
  //
  // El mensaje decía cuándo vuelven los créditos y nada más: un callejón
  // justo en el momento en que alguien quiere seguir. Pro existe y su checkout
  // está cableado, así que callarlo no protegía a nadie.
  it.each(["existing", "create"] as const)(
    "en %s, el muro de créditos ofrece una salida de HOY, no sólo una fecha",
    (contexto) => {
      const m = noCreditsMessage(STATE, contexto);
      expect(m, `el muro de créditos volvió a ser un callejón: ${m}`).toContain("Pro");
      // Y sigue diciendo que el trabajo está a salvo — el orden importa:
      // primero se tranquiliza, después se ofrece.
      expect(m).toMatch(/guardad/);
    },
  );

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
      allotment: CREDITS_BY_PLAN.free,
      refillsAt: new Date("2026-09-23T12:00:00.000Z"),
    });
    expect(mocks.updateReturning).toHaveBeenCalledOnce();
    expect(mocks.updateSet).toHaveBeenCalledWith({
      // La recarga escribe la CIFRA DE LA BASE, o sea centicréditos: 2.000, no
      // 20. Ponerlo a mano aquí volvería a colar un 20 que la app leería como
      // 0,20 créditos y dejaría a todo el mundo sin saldo.
      credits: CREDITS_BY_PLAN.free,
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
      allotment: CREDITS_BY_PLAN.free,
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
      allotment: CREDITS_BY_PLAN.free,
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

  // Las TRES cifras, cacheada incluida. La entrada cacheada es la que más se
  // olvida y la que más cambia el número: es entre 5x y 31x más barata, y
  // durante meses se midió sin cobrarse.
  it.each([
    ["deepseek-flash", 0.22, 0.66, 0.007, FIREWORKS],
    ["deepseek-pro", 1.32, 3.96, 0.044, FIREWORKS],
    ["qwen-vision", 0.40, 1.60, 0.08, FIREWORKS],
  ] as const)("%s cobra lo que cuesta", (rate, input, output, cached, fuente) => {
    expect(creditRate(rate), `fuente: ${fuente}`).toEqual({ input, output, cached });
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
  //
  // ⬇️ EN CENTICRÉDITOS desde el 2026-08-30. Los tres números de antes eran el
  // `Math.ceil` de éstos, y la diferencia es lo que se cobraba de más: crear
  // una página costaba 1,08 y se cobraban 2 — un 85%.
  it("crear una página cuesta 1,08 créditos (se cobraban 2)", () => {
    expect(creditsForUsage(22_000, 9_000, "deepseek-flash")).toBe(108);
    expect(formatCredits(108)).toBe("1.08");
  });

  it("adjuntar una referencia cuesta 1,96 (se cobraban 2, y antes 4)", () => {
    expect(creditsForUsage(25_000, 6_000, "qwen-vision")).toBe(196);
  });

  it("un turno pesado del Agente en Pro cuesta 11,09 (se cobraban 12)", () => {
    expect(creditsForUsage(60_000, 8_000, "deepseek-pro")).toBe(1109);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// LA ENTRADA CACHEADA SE DESCUENTA.
//
// Fireworks cachea el prefijo y lo cobra entre 5x y 31x más barato. OpenLen lo
// MEDÍA en cada turno (`cachedTokens` llega en el evento de uso desde siempre) y
// lo facturaba como si nunca se hubiera cacheado. No era un agujero — era
// margen — pero significaba que lo que un usuario GASTA no era lo que nos
// CUESTA, y con el Agente en Pro esa diferencia pasó a ser de 4x.
describe("la entrada cacheada se descuenta", () => {
  // Los cacheados son un SUBCONJUNTO de la entrada, no un extra: lo fija el
  // validador de fireworks-client.ts, que RECHAZA cachedTokens > inputTokens.
  it("cachear todo el prompt cuesta casi nada, no lo mismo", () => {
    const sinCache = creditsForUsage(200_000, 0, "deepseek-pro", 0);
    const todoCacheado = creditsForUsage(200_000, 0, "deepseek-pro", 200_000);
    expect(sinCache).toBe(2640); // 200k × $1.32/M = $0.264 = 26,40 créditos
    // 200k × $0.044/M = $0.0088 = 0,88 créditos. Antes el suelo de 1 CRÉDITO lo
    // subía a 1 —un 14% de más—; ahora el suelo vale 0,01 y no toca nada.
    expect(todoCacheado).toBe(88);
  });

  it("un turno pesado del Agente baja de 33 créditos a 12", () => {
    // El caso medido: 6 vueltas sobre una página mediana. El prefijo fijo son
    // 13.036 tokens que se repiten idénticos, así que 5 de las 6 pasadas por
    // ese trozo son lecturas de caché.
    const entrada = 226_770;
    const salida = 6_000;
    expect(creditsForUsage(entrada, salida, "deepseek-pro", 0)).toBe(3231);
    const cacheado = Math.round(entrada * 0.75);
    expect(creditsForUsage(entrada, salida, "deepseek-pro", cacheado)).toBeLessThan(
      15 * CENTICREDITOS_POR_CREDITO,
    );
  });

  it("sin tarifa cacheada NO se inventa un descuento", () => {
    // Gemini no tiene cifra cacheada en la tabla. Se cobra todo a precio sin
    // cachear, que es lo que se hacía siempre — mejor cobrar de más a un
    // proveedor que ya no corre por defecto que inventarse un número.
    const a = creditsForUsage(100_000, 5_000, "gemini-flash", 0);
    const b = creditsForUsage(100_000, 5_000, "gemini-flash", 100_000);
    expect(b).toBe(a);
  });

  it("el defecto es 0: quien no lo pase cobra lo de siempre", () => {
    // Un llamador que se olvide no rompe ni regala: cobra como antes. Por eso
    // hay una guarda aparte, abajo, que comprueba que NADIE se olvidó.
    expect(creditsForUsage(50_000, 2_000, "deepseek-flash")).toBe(
      creditsForUsage(50_000, 2_000, "deepseek-flash", 0),
    );
  });

  it.each([
    ["negativo", -5_000],
    ["mayor que la entrada", 999_999],
    ["NaN", Number.NaN],
    ["infinito", Number.POSITIVE_INFINITY],
  ])("un cachedTokens %s no se convierte en un descuento", (_n, valor) => {
    const normal = creditsForUsage(50_000, 2_000, "deepseek-pro", 0);
    const raro = creditsForUsage(50_000, 2_000, "deepseek-pro", valor);
    // Nunca por debajo de cobrar TODO cacheado, nunca por encima de cobrarlo
    // todo sin cachear. Un número imposible no puede salirse de ese rango.
    expect(raro).toBeGreaterThanOrEqual(creditsForUsage(50_000, 2_000, "deepseek-pro", 50_000));
    expect(raro).toBeLessThanOrEqual(normal);
  });
});

// LA GUARDA QUE FALTÓ EN EL PASO ANTERIOR: la función correcta y el cable
// suelto. Aquí el riesgo es el mismo — `cachedTokens` tiene defecto 0, así que
// un llamador que no lo pase sigue cobrando de más EN SILENCIO y ninguna prueba
// de la función lo notaría.
describe("todos los llamadores pasan los tokens cacheados", () => {
  it("ninguna ruta viva llama a creditsForUsage con 3 argumentos", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const infractores: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === ".next") continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
        if (full.endsWith(join("lib", "credits.ts"))) continue;
        const src = readFileSync(full, "utf8");
        // Con conteo de paréntesis, no con un regex: `brain.creditRate()` es un
        // argumento que CONTIENE paréntesis, y una expresión perezosa se corta
        // ahí y cuenta tres donde hay cuatro. La primera versión de esta guarda
        // señaló al Agente por eso — un falso positivo que habría mandado a
        // arreglar código correcto.
        for (const inicio of [...src.matchAll(/creditsForUsage\(/g)].map((m) => m.index!)) {
          let i = inicio + "creditsForUsage(".length;
          let hondo = 1;
          let comas = 0;
          for (; i < src.length && hondo > 0; i++) {
            const c = src[i];
            if (c === "(" || c === "[" || c === "{") hondo += 1;
            else if (c === ")" || c === "]" || c === "}") hondo -= 1;
            else if (c === "," && hondo === 1) comas += 1;
          }
          const cuerpo = src.slice(inicio, i);
          // 3 comas = 4 argumentos.
          if (comas < 3) infractores.push(`${full}: ${cuerpo.replace(/\s+/g, " ").slice(0, 90)}`);
        }
      }
    };
    walk(join(process.cwd(), "app"));
    walk(join(process.cwd(), "lib"));
    expect(
      infractores,
      `estas llamadas cobran la entrada cacheada a precio sin cachear:\n${infractores.join("\n")}`,
    ).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DEVOLVER LO COBRADO POR ALGO QUE NO SE ENTREGÓ.
//
// 🔴 POR QUÉ HACE FALTA. El cargo de una generación se hace DENTRO del stream,
// en el evento `usage`, y la puerta del documento (`preparePage`) corre DESPUÉS,
// en la ruta. Una página que la puerta rechaza ya está cobrada cuando se decide
// no guardarla: el usuario paga y no recibe nada.
describe("refundCredits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("SUMA al saldo — no resta con signo", async () => {
    await refundCredits("u1", 3);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    // Lo que importa es el sentido de la operación: `debitCredits` corta en
    // `amount <= 0`, así que «devolver» pasándole un negativo habría sido un
    // no-op SILENCIOSO — cobrado y sin devolver, y sin un solo error.
    const set = mocks.updateSet.mock.calls[0]![0] as { credits: { strings: string[] } };
    expect(set.credits.strings.join("")).toContain("+");
  });

  it("cero o negativo no toca la base", async () => {
    await refundCredits("u1", 0);
    await refundCredits("u1", -5);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
