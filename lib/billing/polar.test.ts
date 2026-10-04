import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CREDITS_BY_PLAN } from "@/lib/credits";

// Mock the DB the same way webhook-route.test.ts does — a chainable builder.
// `selectRows` is what the user lookup returns; `setMock` captures the UPDATE
// payload so we can assert plan / credit transitions without a real database.
const { selectRows, setMock } = vi.hoisted(() => ({
  selectRows: { value: [] as Array<{ plan: string }> },
  setMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  schema: { users: { id: "id", plan: "plan" } },
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(selectRows.value),
        }),
      }),
    }),
    update: () => ({
      set: (payload: Record<string, unknown>) => {
        setMock(payload);
        return { where: () => Promise.resolve(undefined) };
      },
    }),
  },
}));

import { applySubscriptionState, createCheckout, planForProduct } from "@/lib/billing/polar";

describe("applySubscriptionState", () => {
  beforeEach(() => {
    setMock.mockReset();
    selectRows.value = [];
  });

  it("free + active → pro with the Pro allotment + refreshedAt set", async () => {
    selectRows.value = [{ plan: "free" }];
    await applySubscriptionState({ userId: "u1", status: "active" });
    expect(setMock).toHaveBeenCalledTimes(1);
    const payload = setMock.mock.calls[0][0];
    expect(payload.plan).toBe("pro");
    expect(payload.credits).toBe(CREDITS_BY_PLAN.pro);
    expect(payload.creditsRefreshedAt).toBeInstanceOf(Date);
  });

  it("already-pro + active → no credit refill (anti-refill)", async () => {
    selectRows.value = [{ plan: "pro" }];
    await applySubscriptionState({ userId: "u1", status: "active" });
    const payload = setMock.mock.calls[0][0];
    expect(payload.plan).toBe("pro");
    expect(payload).not.toHaveProperty("credits");
    expect(payload).not.toHaveProperty("creditsRefreshedAt");
  });

  it("trialing keeps pro access", async () => {
    selectRows.value = [{ plan: "free" }];
    await applySubscriptionState({ userId: "u1", status: "trialing" });
    expect(setMock.mock.calls[0][0].plan).toBe("pro");
  });

  it("past_due keeps pro and does NOT refill credits", async () => {
    selectRows.value = [{ plan: "pro" }];
    await applySubscriptionState({ userId: "u1", status: "past_due" });
    const payload = setMock.mock.calls[0][0];
    expect(payload.plan).toBe("pro");
    expect(payload).not.toHaveProperty("credits");
  });

  it("canceled → free", async () => {
    selectRows.value = [{ plan: "pro" }];
    await applySubscriptionState({ userId: "u1", status: "canceled" });
    expect(setMock.mock.calls[0][0].plan).toBe("free");
  });

  it("an unknown status leaves the plan unchanged (no UPDATE)", async () => {
    selectRows.value = [{ plan: "pro" }];
    await applySubscriptionState({ userId: "u1", status: "weird_status" });
    expect(setMock).not.toHaveBeenCalled();
  });

  it("unknown user → no UPDATE", async () => {
    selectRows.value = [];
    await applySubscriptionState({ userId: "ghost", status: "active" });
    expect(setMock).not.toHaveBeenCalled();
  });

  it("persists customerId only when provided (no null overwrite)", async () => {
    selectRows.value = [{ plan: "free" }];
    await applySubscriptionState({ userId: "u1", status: "active" });
    expect(setMock.mock.calls[0][0]).not.toHaveProperty("polarCustomerId");

    setMock.mockReset();
    selectRows.value = [{ plan: "free" }];
    await applySubscriptionState({
      userId: "u1",
      status: "active",
      customerId: "cus_9",
    });
    expect(setMock.mock.calls[0][0].polarCustomerId).toBe("cus_9");
  });
});

// MAX (04/10). Dos productos en Polar: el plan sale del producto de la
// suscripción. Max sólo si es el producto de Max; cualquier otro es Pro, y así
// el Pro de antes (a $3.99, decisión de Jesús: conserva su precio y recibe lo
// mismo que un Pro nuevo) sigue siendo Pro sin que el código lo distinga.
describe("planForProduct", () => {
  const prev = process.env.POLAR_PRODUCT_MAX_ID;
  beforeEach(() => {
    process.env.POLAR_PRODUCT_MAX_ID = "prod_max";
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.POLAR_PRODUCT_MAX_ID;
    else process.env.POLAR_PRODUCT_MAX_ID = prev;
  });

  it("🔴 el producto de Max es Max", () => {
    expect(planForProduct("prod_max")).toBe("max");
  });

  it("cualquier otro producto es Pro (el de $10 y el de $3.99)", () => {
    expect(planForProduct("prod_pro")).toBe("pro");
    expect(planForProduct("prod_pro_viejo")).toBe("pro");
    expect(planForProduct(null)).toBe("pro");
  });

  it("sin el producto de Max configurado, nada se lee como Max", () => {
    delete process.env.POLAR_PRODUCT_MAX_ID;
    expect(planForProduct("prod_max")).toBe("pro");
    expect(planForProduct("")).toBe("pro");
  });
});

describe("applySubscriptionState con Max", () => {
  beforeEach(() => {
    setMock.mockReset();
    selectRows.value = [];
  });

  it("🔴 free + active en Max → max con los créditos de Max", async () => {
    selectRows.value = [{ plan: "free" }];
    await applySubscriptionState({ userId: "u1", status: "active", plan: "max" });
    const payload = setMock.mock.calls[0][0];
    expect(payload.plan).toBe("max");
    expect(payload.credits).toBe(CREDITS_BY_PLAN.max);
    expect(payload.creditsRefreshedAt).toBeInstanceOf(Date);
  });

  it("🔴 pro → max (el cambio de plan en el portal) recibe los créditos de Max", async () => {
    selectRows.value = [{ plan: "pro" }];
    await applySubscriptionState({ userId: "u1", status: "active", plan: "max" });
    const payload = setMock.mock.calls[0][0];
    expect(payload.plan).toBe("max");
    expect(payload.credits).toBe(CREDITS_BY_PLAN.max);
  });

  it("max → pro no recarga: bajar de plan no da créditos", async () => {
    selectRows.value = [{ plan: "max" }];
    await applySubscriptionState({ userId: "u1", status: "active", plan: "pro" });
    const payload = setMock.mock.calls[0][0];
    expect(payload.plan).toBe("pro");
    expect(payload).not.toHaveProperty("credits");
  });

  it("max + past_due sigue en max y no recarga", async () => {
    selectRows.value = [{ plan: "max" }];
    await applySubscriptionState({ userId: "u1", status: "past_due", plan: "max" });
    const payload = setMock.mock.calls[0][0];
    expect(payload.plan).toBe("max");
    expect(payload).not.toHaveProperty("credits");
  });

  it("max + canceled → free", async () => {
    selectRows.value = [{ plan: "max" }];
    await applySubscriptionState({ userId: "u1", status: "canceled", plan: "max" });
    expect(setMock.mock.calls[0][0].plan).toBe("free");
  });
});

describe("createCheckout por plan", () => {
  const saved = { ...process.env };
  const fetchMock = vi.fn();
  beforeEach(() => {
    process.env.POLAR_ACCESS_TOKEN = "polar_tok";
    process.env.POLAR_PRODUCT_PRO_ID = "prod_pro";
    process.env.POLAR_PRODUCT_MAX_ID = "prod_max";
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ url: "https://polar.sh/checkout/x" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...saved };
  });
  const productos = () => JSON.parse(fetchMock.mock.calls[0][1].body as string).products;

  it("🔴 plan max abre el producto de Max", async () => {
    await createCheckout({ userId: "u1", plan: "max" });
    expect(productos()).toEqual(["prod_max"]);
  });

  it("sin plan, o pro, abre el de Pro", async () => {
    await createCheckout({ userId: "u1" });
    expect(productos()).toEqual(["prod_pro"]);
    fetchMock.mockClear();
    await createCheckout({ userId: "u1", plan: "pro" });
    expect(productos()).toEqual(["prod_pro"]);
  });

  it("Max sin su producto configurado falla, no vende Pro en su lugar", async () => {
    delete process.env.POLAR_PRODUCT_MAX_ID;
    await expect(createCheckout({ userId: "u1", plan: "max" })).rejects.toThrow("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
