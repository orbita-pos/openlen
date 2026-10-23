import { describe, expect, it } from "vitest";

import { shopifyStateFor } from "./state";
import { memoryShopifyStore } from "./store";

const ROW = {
  projectId: "p1",
  shopDomain: "hydrogen-preview.myshopify.com",
  primaryDomain: "checkout.hydrogen.shop",
  name: "Hydrogen Demo Store",
  currency: "USD",
  country: "CA",
  productsCount: 22,
  collectionsCount: 6,
  checkedAt: new Date("2026-10-22T10:00:00Z"),
  connectedBy: "person-1",
};

describe("shopifyStateFor", () => {
  it("is null with Shopify off or no store", async () => {
    const store = memoryShopifyStore();
    await store.put(ROW);
    expect(await shopifyStateFor("p1", { enabled: false, store })).toBeNull();
    expect(await shopifyStateFor("p2", { enabled: true, store })).toBeNull();
  });

  it("gives Len the store, from OpenLen's table", async () => {
    const store = memoryShopifyStore();
    await store.put(ROW);
    expect(await shopifyStateFor("p1", { enabled: true, store })).toEqual({
      store_domain: "hydrogen-preview.myshopify.com",
      primary_domain: "checkout.hydrogen.shop",
      name: "Hydrogen Demo Store",
      currency: "USD",
      country: "CA",
      products: 22,
      collections: 6,
      checked_at: "2026-10-22T10:00:00.000Z",
      storefront_api: "https://hydrogen-preview.myshopify.com/api/2026-10/graphql.json",
    });
  });
});
