// lib/shopify/store-pg.ts — THE CONNECTED STORE IN THE APP'S DATABASE (spec local
// 2026-10-22-shopify-storefront, §7). The contract is store-contract.ts.

import "server-only";

import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";

import type { ShopifyStore } from "./types";

const T = schema.shopifyStores;

export const pgShopifyStore: ShopifyStore = {
  async get(projectId) {
    const [r] = await db.select().from(T).where(eq(T.projectId, projectId)).limit(1);
    return r ?? null;
  },
  async put(row) {
    const connectedAt = new Date();
    await db
      .insert(T)
      .values({ ...row, connectedAt })
      .onConflictDoUpdate({ target: T.projectId, set: { ...row, connectedAt } });
  },
  async remove(projectId) {
    await db.delete(T).where(eq(T.projectId, projectId));
  },
};
