// lib/shopify/real.ts — THE REAL DEPENDENCIES of the Shopify pieces (spec local
// 2026-10-22-shopify-storefront): the app's database, the network, and the SSRF gate
// that already guards every server fetch of a host someone typed.

import "server-only";

import { validateUrl } from "@/lib/style-match/scrape/validate-url";

import type { ConnectDeps } from "./connect";
import { shopifyEnabledIn } from "./enabled";
import { pgShopifyStore } from "./store-pg";
import type { ShopifyStore } from "./types";

export function realShopifyStore(): ShopifyStore {
  return pgShopifyStore;
}

export function realConnectDeps(): ConnectDeps {
  return {
    fetch: (input, init) => fetch(input, init),
    isPublicUrl: async (url) => (await validateUrl(url)).ok,
    store: pgShopifyStore,
    now: () => new Date(),
  };
}

/** The connected store's hosts (its myshopify domain and its own), for the box's network. */
export async function storeHostsFor(projectId: string): Promise<readonly string[]> {
  if (!shopifyEnabledIn()) return [];
  const row = await pgShopifyStore.get(projectId).catch(() => null);
  return row ? [...new Set([row.shopDomain, row.primaryDomain])] : [];
}
