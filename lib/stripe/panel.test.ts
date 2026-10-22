import { describe, expect, it, vi } from "vitest";

import { memorySecretStore } from "@/lib/functions/secret-store";

import { stripePanel } from "./panel";
import { memoryStripeStore } from "./store";

const answers: Record<string, unknown> = {
  "/v1/checkout/sessions": { data: [{ id: "cs_1", status: "complete", amount_total: 2900, currency: "usd", customer_details: { email: "ana@example.com" }, created: 1700000000, payment_intent: "pi_1" }] },
  "/v1/payment_intents": { data: [{ id: "pi_1", status: "succeeded", amount: 2900, currency: "usd", created: 1700000000 }, { id: "pi_2", status: "succeeded", amount: 1500, currency: "mxn", created: 1700000500, receipt_email: "beto@example.com" }] },
  "/v1/subscriptions": { data: [{ id: "sub_1", status: "active", customer: { email: "eva@example.com" }, items: { data: [{ price: { id: "price_9", lookup_key: "pro_monthly" } }] } }] },
  "/v1/products": { data: [{ id: "curso", name: "Curso" }] },
  "/v1/prices": { data: [{ id: "price_9", product: "curso", unit_amount: 2900, currency: "usd", recurring: { interval: "month" } }] },
  "/v1/webhook_endpoints": { data: [{ url: "https://x/functions/v1/pago", status: "enabled" }] },
};

async function setup() {
  const store = memoryStripeStore();
  const secrets = memorySecretStore();
  await secrets.set("p", "draft", { STRIPE_SECRET_KEY: "sk_test_x" }, null);
  await store.putAccount({ projectId: "p", environment: "draft", accountId: "acct_1", accountName: "Taller", keyKind: "sk", chargesEnabled: null });
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    return new Response(JSON.stringify(answers[u.pathname] ?? { data: [] }), { status: new Headers(init?.headers).get("authorization") === "Bearer sk_test_x" ? 200 : 401 });
  });
  return { store, secrets, f };
}

describe("stripePanel", () => {
  it("reads Stripe with the key of that environment and builds test dashboard links", async () => {
    const { store, secrets, f } = await setup();
    const p = await stripePanel("p", "draft", { store, secrets, f: f as unknown as typeof fetch });
    expect(p).toMatchObject({
      available: true,
      environment: "draft",
      account: { id: "acct_1", name: "Taller", chargesEnabled: null },
      dashboardUrl: "https://dashboard.stripe.com/test",
    });
    if (!("payments" in p)) throw new Error("no payments");
    expect(p.payments).toEqual([
      { id: "pi_2", amount: 1500, currency: "mxn", email: "beto@example.com", status: "succeeded", created: 1700000500, dashboardUrl: "https://dashboard.stripe.com/test/payments/pi_2" },
      { id: "pi_1", amount: 2900, currency: "usd", email: "ana@example.com", status: "succeeded", created: 1700000000, dashboardUrl: "https://dashboard.stripe.com/test/payments/pi_1" },
    ]);
    expect(p.subscriptions).toEqual([{ id: "sub_1", status: "active", email: "eva@example.com", price: "pro_monthly", dashboardUrl: "https://dashboard.stripe.com/test/subscriptions/sub_1" }]);
    expect(p.products).toEqual([{ id: "curso", name: "Curso", prices: [{ id: "price_9", amount: 2900, currency: "usd", interval: "month" }] }]);
    expect(p.webhookEndpoints).toEqual([{ url: "https://x/functions/v1/pago", status: "enabled" }]);
  });

  it("no key in that environment → the account is null and Stripe isn't called", async () => {
    const { store, secrets, f } = await setup();
    expect(await stripePanel("p", "live", { store, secrets, f: f as unknown as typeof fetch })).toEqual({ available: true, environment: "live", account: null });
    expect(f).not.toHaveBeenCalled();
  });
});
