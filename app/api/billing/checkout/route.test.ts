// El checkout, con dos planes de pago (04/10: Pro $9.99 y Max $19.99).
//
// - Lee `plan=max` (la portada ya lo mandaba y nadie lo leía: «Pásate a Max»
//   vendía Pro).
// - Quien YA paga no abre un segundo checkout: va al portal de Polar, donde se
//   cambia de plan (decisión de Jesús). Polar, además, no deja tener dos
//   suscripciones a la vez.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(async () => ({ user: { id: "u1", email: "ana@tiendaluna.mx" } })),
  plan: { value: "free" as "free" | "pro" | "max" },
  createCheckout: vi.fn(async (_o: { plan?: string }) => "https://polar.sh/checkout/x"),
  createCustomerPortalUrl: vi.fn(async (_id: string) => "https://polar.sh/portal/x"),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/limits", () => ({ getUserPlan: async () => mocks.plan.value }));
vi.mock("@/lib/billing/polar", () => ({
  billingConfigured: () => true,
  createCheckout: mocks.createCheckout,
  createCustomerPortalUrl: mocks.createCustomerPortalUrl,
}));

import { GET } from "./route";

const get = (qs: string) => GET(new NextRequest(`http://localhost/api/billing/checkout?${qs}`));

describe("GET /api/billing/checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.plan.value = "free";
  });

  it("🔴 plan=max abre el checkout de Max", async () => {
    const res = await get("plan=max&locale=es");
    expect(mocks.createCheckout).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", plan: "max" }));
    expect(res.headers.get("location")).toBe("https://polar.sh/checkout/x");
  });

  it("sin plan, o con uno que no existe, es Pro", async () => {
    await get("locale=es");
    expect(mocks.createCheckout).toHaveBeenLastCalledWith(expect.objectContaining({ plan: "pro" }));
    await get("plan=enterprise&locale=es");
    expect(mocks.createCheckout).toHaveBeenLastCalledWith(expect.objectContaining({ plan: "pro" }));
  });

  it("🔴 un Pro que pide Max va al portal, no a una segunda suscripción", async () => {
    mocks.plan.value = "pro";
    const res = await get("plan=max&locale=es");
    expect(mocks.createCheckout).not.toHaveBeenCalled();
    expect(mocks.createCustomerPortalUrl).toHaveBeenCalledWith("u1");
    expect(res.headers.get("location")).toBe("https://polar.sh/portal/x");
  });

  it("un Max que pide Pro, también", async () => {
    mocks.plan.value = "max";
    await get("locale=es");
    expect(mocks.createCheckout).not.toHaveBeenCalled();
    expect(mocks.createCustomerPortalUrl).toHaveBeenCalledWith("u1");
  });
});
