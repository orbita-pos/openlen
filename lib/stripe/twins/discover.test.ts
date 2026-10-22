import { describe, expect, it } from "vitest";

import { findStripeRefs, kindOfId } from "./discover";

describe("findStripeRefs", () => {
  it("finds test ids and test payment links, not live links", () => {
    const r = findStripeRefs(['<a href="https://buy.stripe.com/test_8wM3cd">', 'price: "price_1QabcdEFGHijklmn"', "https://buy.stripe.com/8wM3cd"]);
    expect([...r.links]).toEqual(["https://buy.stripe.com/test_8wM3cd"]);
    expect([...r.ids]).toEqual(["price_1QabcdEFGHijklmn"]);
  });

  it("knows the five kinds of ids, and ignores short look-alikes", () => {
    const r = findStripeRefs(["prod_ABCDEFGHIJKLMN plink_1Qabcdefghijklmn shr_1Qabcdefghijklmn bpc_1Qabcdefghijklmn price_x stripe.prices.list"]);
    expect([...r.ids]).toEqual(["prod_ABCDEFGHIJKLMN", "plink_1Qabcdefghijklmn", "shr_1Qabcdefghijklmn", "bpc_1Qabcdefghijklmn"]);
  });

  it("a link with a query keeps only the link", () => {
    expect([...findStripeRefs(["https://buy.stripe.com/test_8wM3cd?prefilled_email=a%40b.c"]).links]).toEqual(["https://buy.stripe.com/test_8wM3cd"]);
  });
});

describe("kindOfId", () => {
  it("by prefix", () => {
    expect(kindOfId("prod_1")).toBe("product");
    expect(kindOfId("price_1")).toBe("price");
    expect(kindOfId("plink_1")).toBe("payment_link");
    expect(kindOfId("shr_1")).toBe("shipping_rate");
    expect(kindOfId("bpc_1")).toBe("portal_configuration");
    expect(kindOfId("we_1")).toBe("webhook_endpoint");
    expect(kindOfId("cus_1")).toBeNull();
  });
});
