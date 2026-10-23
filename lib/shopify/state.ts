// lib/shopify/state.ts — WHAT LEN KNOWS OF THE PROJECT'S STORE every turn (spec local
// 2026-10-22-shopify-storefront, §6.7), in PROJECT STATE beside Stripe and the email.
// From OpenLen's table, never from Shopify on each turn: Len reads the catalog live
// with curl. null with Shopify off or no store.

import { storefrontApiUrl } from "./storefront";
import type { ShopifyStore, ShopifyStoreRow } from "./types";

export interface ShopifyStateForLen {
  readonly store_domain: string;
  readonly primary_domain: string;
  readonly name: string;
  readonly currency: string;
  readonly country: string;
  readonly products: number;
  readonly collections: number;
  /** When the counts were read (ISO). */
  readonly checked_at: string;
  readonly storefront_api: string;
}

export function shopifyStateOf(row: ShopifyStoreRow): ShopifyStateForLen {
  return {
    store_domain: row.shopDomain,
    primary_domain: row.primaryDomain,
    name: row.name,
    currency: row.currency,
    country: row.country,
    products: row.productsCount,
    collections: row.collectionsCount,
    checked_at: row.checkedAt.toISOString(),
    storefront_api: storefrontApiUrl(row.shopDomain),
  };
}

async function realStateDeps(): Promise<{ enabled: boolean; store: ShopifyStore }> {
  const [{ shopifyEnabledIn }, { realShopifyStore }] = await Promise.all([import("./enabled"), import("./real")]);
  return { enabled: shopifyEnabledIn(), store: realShopifyStore() };
}

export async function shopifyStateFor(projectId: string, deps?: { enabled: boolean; store: ShopifyStore }): Promise<ShopifyStateForLen | null> {
  const d = deps ?? (await realStateDeps());
  if (!d.enabled) return null;
  const row = await d.store.get(projectId);
  return row ? shopifyStateOf(row) : null;
}
