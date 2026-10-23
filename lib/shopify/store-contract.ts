// lib/shopify/store-contract.ts — what any ShopifyStore must do, as a suite both
// implementations run: memory (store.test.ts) and Postgres (store-pg.pg.test.ts).
// Not a test file itself: the two test files call it.

import { describe, expect, it } from "vitest";

import type { ShopifyStore, ShopifyStoreRow } from "./types";

export interface ShopifyStoreSetup {
  readonly store: ShopifyStore;
  /** Two projects and a person that exist (Postgres needs the rows for its foreign keys). */
  readonly projectA: string;
  readonly projectB: string;
  readonly person: string;
}

const row = (projectId: string, person: string | null, o: Partial<Omit<ShopifyStoreRow, "connectedAt">> = {}): Omit<ShopifyStoreRow, "connectedAt"> => ({
  projectId,
  shopDomain: "hydrogen-preview.myshopify.com",
  primaryDomain: "checkout.hydrogen.shop",
  name: "Hydrogen Demo Store",
  currency: "USD",
  country: "CA",
  productsCount: 22,
  collectionsCount: 6,
  checkedAt: new Date("2026-10-22T10:00:00Z"),
  connectedBy: person,
  ...o,
});

export function describeShopifyStoreContract(name: string, setup: () => Promise<ShopifyStoreSetup>): void {
  describe(`${name}: the ShopifyStore contract`, () => {
    it("an unknown project has no store", async () => {
      const { store, projectA } = await setup();
      expect(await store.get(projectA)).toBeNull();
    });

    it("a row round-trips with every field, and connectedAt set", async () => {
      const { store, projectA, person } = await setup();
      await store.put(row(projectA, person));
      expect(await store.get(projectA)).toEqual({ ...row(projectA, person), connectedAt: expect.any(Date) });
    });

    it("a second put replaces every field and moves connectedAt forward", async () => {
      const { store, projectA, person } = await setup();
      await store.put(row(projectA, person));
      const first = (await store.get(projectA))!.connectedAt;
      await new Promise((r) => setTimeout(r, 5));
      const other = row(projectA, null, {
        shopDomain: "otra.myshopify.com",
        primaryDomain: "www.otra.mx",
        name: "Otra",
        currency: "MXN",
        country: "MX",
        productsCount: 3,
        collectionsCount: 1,
        checkedAt: new Date("2026-10-22T12:00:00Z"),
      });
      await store.put(other);
      const after = await store.get(projectA);
      expect(after).toEqual({ ...other, connectedAt: expect.any(Date) });
      expect(after!.connectedAt.getTime()).toBeGreaterThan(first.getTime());
    });

    it("two projects may hold the same store", async () => {
      const { store, projectA, projectB, person } = await setup();
      await store.put(row(projectA, person));
      await store.put(row(projectB, person));
      expect((await store.get(projectA))?.shopDomain).toBe("hydrogen-preview.myshopify.com");
      expect((await store.get(projectB))?.shopDomain).toBe("hydrogen-preview.myshopify.com");
    });

    it("remove forgets it, and removing twice doesn't throw", async () => {
      const { store, projectA, projectB, person } = await setup();
      await store.put(row(projectA, person));
      await store.put(row(projectB, person));
      await store.remove(projectA);
      await store.remove(projectA);
      expect(await store.get(projectA)).toBeNull();
      expect(await store.get(projectB)).not.toBeNull();
    });
  });
}
