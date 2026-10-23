// lib/shopify/store.ts — the ShopifyStore in memory, for the tests of everything
// above it. The contract both implementations keep is store-contract.ts; the
// Postgres one is store-pg.ts.

import type { ShopifyStore, ShopifyStoreRow } from "./types";

export type { ShopifyStore } from "./types";

export function memoryShopifyStore(now: () => Date = () => new Date()): ShopifyStore {
  const rows = new Map<string, ShopifyStoreRow>();
  return {
    async get(projectId) {
      return rows.get(projectId) ?? null;
    },
    async put(row) {
      rows.set(row.projectId, { ...row, connectedAt: now() });
    },
    async remove(projectId) {
      rows.delete(projectId);
    },
  };
}
