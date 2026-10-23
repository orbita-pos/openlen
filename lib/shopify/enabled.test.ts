import { describe, expect, it } from "vitest";

import { shopifyEnabledIn } from "./enabled";

describe("shopifyEnabledIn", () => {
  it("is on unless OPENLEN_SHOPIFY is 0", () => {
    expect(shopifyEnabledIn({})).toBe(true);
    expect(shopifyEnabledIn({ OPENLEN_SHOPIFY: "1" })).toBe(true);
    expect(shopifyEnabledIn({ OPENLEN_SHOPIFY: "0" })).toBe(false);
    expect(shopifyEnabledIn({ OPENLEN_SHOPIFY: " 0 " })).toBe(false);
  });
});
