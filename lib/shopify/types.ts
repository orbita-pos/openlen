// lib/shopify/types.ts — THE CONNECTED STORE (spec local 2026-10-22-shopify-storefront, §7):
// one row per project, nothing secret. What it is and who connected it; the catalog
// itself is never copied — pages and Len read it from Shopify live.

export interface ShopifyStoreRow {
  readonly projectId: string;
  /** "x.myshopify.com": the host every server call goes to. */
  readonly shopDomain: string;
  /** meta.json's `domain`, e.g. "www.tienda.com". */
  readonly primaryDomain: string;
  readonly name: string;
  /** "MXN". */
  readonly currency: string;
  /** The ISO code for <shopify-store country>. */
  readonly country: string;
  readonly productsCount: number;
  readonly collectionsCount: number;
  readonly checkedAt: Date;
  readonly connectedAt: Date;
  /** `personOf(session)`; null once that user is gone. */
  readonly connectedBy: string | null;
}

export interface ShopifyStore {
  get(projectId: string): Promise<ShopifyStoreRow | null>;
  /** Upsert by project; connectedAt becomes now (a reconnect is a new connection). */
  put(row: Omit<ShopifyStoreRow, "connectedAt">): Promise<void>;
  remove(projectId: string): Promise<void>;
}
