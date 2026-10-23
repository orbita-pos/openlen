// @vitest-environment node
//
// Connecting a project to a store (spec local 2026-10-22-shopify-storefront, §6.1):
// what reading it found is saved, a failure saves nothing.
import { describe, expect, it } from "vitest";

import { connectStore, type ConnectDeps } from "./connect";
import { memoryShopifyStore } from "./store";

const META = (o: Record<string, unknown> = {}) => ({
  name: "Hydrogen Demo Store",
  country: "CA",
  currency: "USD",
  domain: "checkout.hydrogen.shop",
  myshopify_domain: "hydrogen-preview.myshopify.com",
  published_products_count: 22,
  published_collections_count: 6,
  ...o,
});
const GRAPHQL = (products: unknown[] = [{ handle: "v2-snowboard", title: "The Hydrogen Snowboard", availableForSale: true, priceRange: { minVariantPrice: { amount: "500.0", currencyCode: "USD" }, maxVariantPrice: { amount: "500.0", currencyCode: "USD" } } }]) => ({
  data: { shop: { name: "Hydrogen Demo Store" }, localization: { availableCountries: [{ isoCode: "CA" }] }, collections: { nodes: [] }, products: { nodes: products } },
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const NOW = new Date("2026-10-22T10:00:00Z");

function deps(answers: Record<string, () => Response>): ConnectDeps {
  return {
    store: memoryShopifyStore(() => NOW),
    now: () => NOW,
    isPublicUrl: async () => true,
    fetch: (async (input: string | URL | Request) => answers[String(input)]?.() ?? new Response("nope", { status: 404 })) as typeof fetch,
  };
}

const DEMO = {
  "https://checkout.hydrogen.shop/meta.json": () => json(META()),
  "https://hydrogen-preview.myshopify.com/api/2026-10/graphql.json": () => json(GRAPHQL()),
};

describe("connectStore", () => {
  it("saves what it found, with who connected it and when it was checked", async () => {
    const d = deps(DEMO);
    const r = await connectStore("p1", "checkout.hydrogen.shop", "person-1", d);
    expect(r.kind).toBe("ok");
    expect(await d.store.get("p1")).toEqual({
      projectId: "p1",
      shopDomain: "hydrogen-preview.myshopify.com",
      primaryDomain: "checkout.hydrogen.shop",
      name: "Hydrogen Demo Store",
      currency: "USD",
      country: "CA",
      productsCount: 22,
      collectionsCount: 6,
      checkedAt: NOW,
      connectedAt: NOW,
      connectedBy: "person-1",
    });
    expect(r.kind === "ok" && r.emptyCatalog).toBe(false);
  });

  it("connecting another store replaces the first", async () => {
    const d = deps({
      ...DEMO,
      "https://otra.mx/meta.json": () => json(META({ name: "Otra", domain: "otra.mx", myshopify_domain: "otra.myshopify.com", currency: "MXN" })),
      "https://otra.myshopify.com/api/2026-10/graphql.json": () => json(GRAPHQL()),
    });
    await connectStore("p1", "checkout.hydrogen.shop", "person-1", d);
    await connectStore("p1", "otra.mx", "person-2", d);
    expect(await d.store.get("p1")).toMatchObject({ shopDomain: "otra.myshopify.com", name: "Otra", currency: "MXN", connectedBy: "person-2" });
  });

  it("a failure saves nothing and leaves the connected store alone", async () => {
    const d = deps({ ...DEMO, "https://cerrada.mx/meta.json": () => new Response(null, { status: 302, headers: { location: "/password" } }) });
    await connectStore("p1", "checkout.hydrogen.shop", "person-1", d);
    for (const bad of ["localhost", "cerrada.mx", "nadie.mx"]) {
      const r = await connectStore("p1", bad, "person-2", d);
      expect(r.kind).not.toBe("ok");
      expect((await d.store.get("p1"))?.shopDomain).toBe("hydrogen-preview.myshopify.com");
    }
    expect((await connectStore("p2", "cerrada.mx", "person-2", d)).kind).toBe("password");
    expect(await d.store.get("p2")).toBeNull();
  });

  it("says when the store has products but none came back without a key", async () => {
    const d = deps({ ...DEMO, "https://hydrogen-preview.myshopify.com/api/2026-10/graphql.json": () => json(GRAPHQL([])) });
    const r = await connectStore("p1", "checkout.hydrogen.shop", null, d);
    expect(r.kind === "ok" && r.emptyCatalog).toBe(true);
  });
});
