// lib/shopify/panel.ts — WHAT THE SHOPIFY TAB SHOWS (spec local 2026-10-22-shopify-storefront,
// §6.6): the connected store, from OpenLen's table, with a link to its Shopify admin. Read
// only: there is no copy of the catalog. Only the owner gets here (the route checks).

import type { ShopifyStore, ShopifyStoreRow } from "./types";

export interface ShopifyPanel {
  readonly available: boolean;
  readonly store:
    | (Pick<ShopifyStoreRow, "name" | "shopDomain" | "primaryDomain" | "currency" | "country" | "productsCount" | "collectionsCount" | "checkedAt" | "connectedAt"> & {
        readonly adminUrl: string;
      })
    | null;
}

export async function shopifyPanel(projectId: string, store: ShopifyStore): Promise<ShopifyPanel> {
  const row = await store.get(projectId);
  if (!row) return { available: true, store: null };
  const { name, shopDomain, primaryDomain, currency, country, productsCount, collectionsCount, checkedAt, connectedAt } = row;
  return {
    available: true,
    store: {
      name,
      shopDomain,
      primaryDomain,
      currency,
      country,
      productsCount,
      collectionsCount,
      checkedAt,
      connectedAt,
      adminUrl: `https://admin.shopify.com/store/${shopDomain.replace(/\.myshopify\.com$/, "")}`,
    },
  };
}
