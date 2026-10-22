import { describe, expect, it } from "vitest";

import { stripeStateFor } from "./state";
import { memoryStripeStore } from "./store";

describe("stripeStateFor", () => {
  it("reads the tables, never Stripe, and never a value", async () => {
    const store = memoryStripeStore();
    await store.putAccount({ projectId: "p", environment: "draft", accountId: "acct_1", accountName: "Taller", keyKind: "rk", chargesEnabled: null });
    await store.putAccount({ projectId: "p", environment: "live", accountId: "acct_1", accountName: "Taller", keyKind: "sk", chargesEnabled: false });
    await store.recordTestObject({ projectId: "p", kind: "webhook_endpoint", testId: "we_1", source: "cli", testUrl: "https://d/functions/v1/pago", functionName: "pago", secretName: "STRIPE_WEBHOOK_SECRET" });
    await store.recordTestObject({ projectId: "p", kind: "product", testId: "curso", source: "cli" });
    expect(await stripeStateFor("p", store)).toEqual({
      draft: { account_id: "acct_1", account_name: "Taller", key: "restricted" },
      production: { account_id: "acct_1", account_name: "Taller", key: "secret", charges_enabled: false },
      webhook_endpoints: [{ url: "https://d/functions/v1/pago", function: "pago", secret: "STRIPE_WEBHOOK_SECRET" }],
    });
  });

  it("null when there is no account and no endpoint", async () => {
    const store = memoryStripeStore();
    await store.recordTestObject({ projectId: "p", kind: "product", testId: "curso", source: "cli" });
    expect(await stripeStateFor("p", store)).toBeNull();
  });
});
