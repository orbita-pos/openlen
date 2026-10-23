// connect_shopify_store (spec local 2026-10-22-shopify-storefront, §6.1): Len connects
// the user's store by its domain, in the turn, and reads back what it found.
import { describe, expect, it, vi } from "vitest";

import type { AgentDeps, AgentSession } from "@/lib/agent/tools";
import type { ConnectStoreResult } from "@/lib/shopify/connect";

import { toolConnectShopifyStore } from "./connect-shopify-store";

const OWNER: AgentSession = { projectId: "p1", userId: "u1" } as AgentSession;
const EDITOR: AgentSession = { projectId: "p1", userId: "u1", personId: "u2" } as AgentSession;

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
  connectedAt: new Date("2026-10-22T10:00:00Z"),
  connectedBy: "u1",
};
const SAMPLE = {
  collections: [{ handle: "freestyle", title: "Freestyle Collection" }],
  products: [{ handle: "v2-snowboard", title: "The Hydrogen Snowboard", availableForSale: true, minPrice: "500.0", maxPrice: "500.0", currency: "USD" }],
};
const OK: ConnectStoreResult = { kind: "ok", row: ROW, sample: SAMPLE, emptyCatalog: false };

function deps(result: ConnectStoreResult = OK) {
  const connectShopifyStore = vi.fn(async () => result);
  return { d: { connectShopifyStore } as unknown as AgentDeps, connectShopifyStore };
}

describe("connect_shopify_store", () => {
  it("connects by the domain the user gave and tells Len what it found", async () => {
    const { d, connectShopifyStore } = deps();
    const r = await toolConnectShopifyStore(OWNER, { domain: "tienda.com" }, d);
    expect(connectShopifyStore).toHaveBeenCalledWith("p1", "tienda.com", "u1");
    expect(r.response).toEqual({
      ok: true,
      shopify: {
        store_domain: "hydrogen-preview.myshopify.com",
        primary_domain: "checkout.hydrogen.shop",
        name: "Hydrogen Demo Store",
        currency: "USD",
        country: "CA",
        products: 22,
        collections: 6,
        checked_at: "2026-10-22T10:00:00.000Z",
        storefront_api: "https://hydrogen-preview.myshopify.com/api/2026-10/graphql.json",
      },
      collections: SAMPLE.collections,
      products: SAMPLE.products,
      result:
        'Connected Hydrogen Demo Store (hydrogen-preview.myshopify.com): 22 products and 6 collections, prices in USD. Use country="CA" on <shopify-store>. For the rest of the catalog, query the Storefront API with curl: POST https://hydrogen-preview.myshopify.com/api/2026-10/graphql.json.',
    });
  });

  it("an editor connects too, as themself", async () => {
    const { d, connectShopifyStore } = deps();
    await toolConnectShopifyStore(EDITOR, { domain: "tienda.com" }, d);
    expect(connectShopifyStore).toHaveBeenCalledWith("p1", "tienda.com", "u2");
  });

  it("says so when the store has products but none came back without a key", async () => {
    const { d } = deps({ ...OK, emptyCatalog: true });
    const r = await toolConnectShopifyStore(OWNER, { domain: "tienda.com" }, d);
    expect(String(r.response.result)).toMatch(
      / Without a key the Storefront API returned no products although the store has some: they may not be published to the Online Store channel\. Tell the user\.$/,
    );
  });

  it("each failure comes back as its own error", async () => {
    const cases: [ConnectStoreResult, string][] = [
      [{ kind: "invalid_domain", message: "x" }, "That isn't a store domain (like tienda.com or tienda.myshopify.com). Ask the user for it."],
      [{ kind: "not_shopify", message: "x" }, "tienda.com isn't an open Shopify store."],
      [{ kind: "password", message: "x" }, "The store is password-protected: Shopify opens its catalog only once the store is open. Tell the user."],
      [{ kind: "unreachable", message: "it took over 15 s" }, "The store didn't answer: it took over 15 s. Try again in a moment."],
      [{ kind: "storefront_closed", message: "HTTP 401" }, "The store didn't answer: HTTP 401. Try again in a moment."],
    ];
    for (const [result, error] of cases) {
      const { d } = deps(result);
      expect((await toolConnectShopifyStore(OWNER, { domain: "tienda.com" }, d)).response).toEqual({ ok: false, error });
    }
  });

  it("without a domain it asks Len for one, and nothing is called", async () => {
    const { d, connectShopifyStore } = deps();
    for (const args of [{}, { domain: 7 }, { domain: "  " }]) {
      expect((await toolConnectShopifyStore(OWNER, args, d)).response).toEqual({
        ok: false,
        error: "That isn't a store domain (like tienda.com or tienda.myshopify.com). Ask the user for it.",
      });
    }
    expect(connectShopifyStore).not.toHaveBeenCalled();
  });

  it("a server without Shopify says so", async () => {
    const r = await toolConnectShopifyStore(OWNER, { domain: "tienda.com" }, {} as AgentDeps);
    expect(r.response).toEqual({ ok: false, error: "Shopify isn't available on this server." });
  });
});
