// lib/shopify/connect.ts — CONNECTING A PROJECT TO ITS STORE (spec local
// 2026-10-22-shopify-storefront, §6.1): read it, and save it only if reading worked.
// Connecting another store replaces the first. Pure apart from ConnectDeps.

import { readStore, type CatalogSample, type ReadStoreResult, type StorefrontDeps } from "./storefront";
import type { ShopifyStore, ShopifyStoreRow } from "./types";

export interface ConnectDeps extends StorefrontDeps {
  store: ShopifyStore;
  now(): Date;
}

export type ConnectStoreResult =
  | { kind: "ok"; row: ShopifyStoreRow; sample: CatalogSample; emptyCatalog: boolean }
  | Exclude<ReadStoreResult, { kind: "ok" }>;

export async function connectStore(projectId: string, input: string, personId: string | null, d: ConnectDeps): Promise<ConnectStoreResult> {
  const r = await readStore(input, d);
  if (r.kind !== "ok") return r;
  await d.store.put({ projectId, ...r.facts, checkedAt: d.now(), connectedBy: personId });
  const row = await d.store.get(projectId);
  if (!row) throw new Error("the connected store wasn't saved");
  // Without a key, a store whose products aren't in the Online Store may answer none (spec §6.1).
  return { kind: "ok", row, sample: r.sample, emptyCatalog: r.facts.productsCount > 0 && r.sample.products.length === 0 };
}
