import { describe, expect, it } from "vitest";

import { findResource, STRIPE_CLI_COMMIT, STRIPE_CLI_RESOURCES } from "./specs";

describe("the stripe-cli table", () => {
  it("pins a stripe-cli commit and has the v1 resources", () => {
    expect(STRIPE_CLI_COMMIT).toMatch(/^[0-9a-f]{40}$/);
    for (const r of [
      "products", "prices", "payment_links", "checkout sessions", "customers", "subscriptions", "billing_portal configurations",
      "billing_portal sessions", "webhook_endpoints", "events", "payment_intents", "charges", "invoices", "coupons",
      "promotion_codes", "shipping_rates", "refunds", "balance",
    ]) {
      expect(findResource(r.split(" ")), r).not.toBeNull();
    }
  });

  it("an operation has its method, path and typed params as in specs_gen.go", () => {
    const products = findResource(["products"])!;
    expect(products).toMatchObject({ name: "products", consumed: 1 });
    expect(products.operations.create).toMatchObject({ name: "create", method: "POST", path: "/v1/products" });
    expect(products.operations.create!.params.active).toBe("boolean");
    expect(products.operations.update!.path).toBe("/v1/products/{id}");
    const sessions = findResource(["checkout", "sessions", "list"])!;
    expect(sessions).toMatchObject({ name: "checkout sessions", consumed: 2 });
    expect(sessions.operations.list!.path).toBe("/v1/checkout/sessions");
  });

  it("an unknown word is not a resource", () => {
    expect(findResource(["nope"])).toBeNull();
    expect(findResource(["checkout"])).toBeNull();
  });

  it("lists the resources it knows", () => {
    expect(STRIPE_CLI_RESOURCES).toContain("payment_links");
  });
});
