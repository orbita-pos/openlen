// @vitest-environment node
//
// The Stripe tables in Postgres. Runs ONLY on a throwaway database:
// DATABASE_URL=postgres://postgres@127.0.0.1:5562/openlen, migrated with scripts/stripe-migrate.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";

import { pgStripeStore } from "./store-pg";
import { describeStripeStoreContract } from "./store-contract";

const OWNER = "test-stripe-owner";
const A = "test-stripe-project-a";
const B = "test-stripe-project-b";

async function freshProjects(): Promise<void> {
  for (const id of [A, B]) {
    await db.delete(schema.projects).where(eq(schema.projects.id, id));
    await db.insert(schema.projects).values({ id, userId: OWNER, title: "stripe", brief: "", data: { html: "<p>x</p>" } });
  }
}

beforeAll(async () => {
  await exigirBaseLocal();
  await db.insert(schema.users).values({ id: OWNER, email: `${OWNER}@example.invalid`, name: OWNER }).onConflictDoNothing();
});
beforeEach(freshProjects);
afterAll(async () => {
  for (const id of [A, B]) await db.delete(schema.projects).where(eq(schema.projects.id, id));
  await db.delete(schema.users).where(eq(schema.users.id, OWNER));
});

describeStripeStoreContract("pgStripeStore", async () => ({ store: pgStripeStore, projectA: A, projectB: B }));

describe("pgStripeStore and the project", () => {
  it("deleting the project deletes its rows", async () => {
    await pgStripeStore.putAccount({ projectId: A, environment: "draft", accountId: "acct_1", accountName: null, keyKind: "sk", chargesEnabled: null });
    await pgStripeStore.recordTestObject({ projectId: A, kind: "product", testId: "curso", source: "cli" });
    await db.delete(schema.projects).where(eq(schema.projects.id, A));
    expect(await pgStripeStore.listObjects(A)).toEqual([]);
    expect(await pgStripeStore.getAccount(A, "draft")).toBeNull();
  });
});
