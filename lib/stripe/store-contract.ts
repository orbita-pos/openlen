// lib/stripe/store-contract.ts — what any StripeStore must do, as a suite both
// implementations run: memory (store.test.ts) and Postgres (store-pg.pg.test.ts).
// Not a test file itself: the two test files call it.

import { describe, expect, it } from "vitest";

import type { StripeStore } from "./store";

export interface StripeStoreSetup {
  readonly store: StripeStore;
  /** Two projects that exist (Postgres needs the rows for its foreign keys). */
  readonly projectA: string;
  readonly projectB: string;
}

export function describeStripeStoreContract(name: string, setup: () => Promise<StripeStoreSetup>): void {
  describe(`${name}: the StripeStore contract`, () => {
    it("accounts are per environment", async () => {
      const { store, projectA } = await setup();
      await store.putAccount({ projectId: projectA, environment: "draft", accountId: "acct_1", accountName: "Taller", keyKind: "rk", chargesEnabled: null });
      await store.putAccount({ projectId: projectA, environment: "live", accountId: "acct_1", accountName: "Taller", keyKind: "sk", chargesEnabled: false });
      expect(await store.getAccount(projectA, "draft")).toMatchObject({ accountId: "acct_1", keyKind: "rk", chargesEnabled: null, checkedAt: expect.any(Date) });
      expect(await store.getAccount(projectA, "live")).toMatchObject({ keyKind: "sk", chargesEnabled: false });
      await store.deleteAccount(projectA, "live");
      expect(await store.getAccount(projectA, "live")).toBeNull();
      expect(await store.getAccount(projectA, "draft")).toMatchObject({ accountId: "acct_1" });
    });

    it("putAccount replaces the row of that environment", async () => {
      const { store, projectA } = await setup();
      await store.putAccount({ projectId: projectA, environment: "draft", accountId: "acct_1", accountName: null, keyKind: "sk", chargesEnabled: null });
      await store.putAccount({ projectId: projectA, environment: "draft", accountId: "acct_2", accountName: "B", keyKind: "rk", chargesEnabled: true });
      expect(await store.getAccount(projectA, "draft")).toMatchObject({ accountId: "acct_2", accountName: "B", keyKind: "rk", chargesEnabled: true });
    });

    it("recordTestObject upserts and a cli record is not downgraded to files", async () => {
      const { store, projectA } = await setup();
      await store.recordTestObject({ projectId: projectA, kind: "product", testId: "curso", source: "cli" });
      await store.recordTestObject({ projectId: projectA, kind: "product", testId: "curso", source: "files" });
      const rows = await store.listObjects(projectA);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ projectId: projectA, kind: "product", testId: "curso", source: "cli", liveId: null, liveUrl: null, fingerprint: null, syncedAt: null });
    });

    it("a later record fills the fields it brings and keeps the others", async () => {
      const { store, projectA } = await setup();
      await store.recordTestObject({ projectId: projectA, kind: "webhook_endpoint", testId: "we_1", source: "cli", testUrl: "https://d/functions/v1/pago", functionName: "pago" });
      await store.recordTestObject({ projectId: projectA, kind: "webhook_endpoint", testId: "we_1", source: "cli", secretName: "STRIPE_WEBHOOK_SECRET" });
      expect((await store.listObjects(projectA))[0]).toMatchObject({ testUrl: "https://d/functions/v1/pago", functionName: "pago", secretName: "STRIPE_WEBHOOK_SECRET" });
    });

    it("setTwin keeps the live id, url and fingerprint; clearTwin forgets them", async () => {
      const { store, projectA } = await setup();
      await store.recordTestObject({ projectId: projectA, kind: "payment_link", testId: "plink_t", source: "cli", testUrl: "https://buy.stripe.com/test_a" });
      await store.setTwin(projectA, "plink_t", { liveId: "plink_l", liveUrl: "https://buy.stripe.com/a", fingerprint: "f1" });
      expect((await store.listObjects(projectA))[0]).toMatchObject({ liveId: "plink_l", liveUrl: "https://buy.stripe.com/a", fingerprint: "f1", syncedAt: expect.any(Date) });
      await store.clearTwin(projectA, "plink_t");
      expect((await store.listObjects(projectA))[0]).toMatchObject({ liveId: null, liveUrl: null, fingerprint: null, syncedAt: null });
    });

    it("forgetTestObject removes the row; projects don't see each other's rows", async () => {
      const { store, projectA, projectB } = await setup();
      await store.recordTestObject({ projectId: projectA, kind: "price", testId: "price_a", source: "cli", lookupKey: "curso" });
      await store.recordTestObject({ projectId: projectB, kind: "price", testId: "price_b", source: "cli" });
      expect((await store.listObjects(projectA)).map((r) => r.testId)).toEqual(["price_a"]);
      await store.forgetTestObject(projectA, "price_a");
      expect(await store.listObjects(projectA)).toEqual([]);
      expect((await store.listObjects(projectB)).map((r) => r.testId)).toEqual(["price_b"]);
    });

    it("lists in creation order", async () => {
      const { store, projectA } = await setup();
      await store.recordTestObject({ projectId: projectA, kind: "product", testId: "p1", source: "cli" });
      await store.recordTestObject({ projectId: projectA, kind: "price", testId: "price_2", source: "cli" });
      await store.recordTestObject({ projectId: projectA, kind: "payment_link", testId: "plink_3", source: "files" });
      expect((await store.listObjects(projectA)).map((r) => r.testId)).toEqual(["p1", "price_2", "plink_3"]);
    });
  });
}
