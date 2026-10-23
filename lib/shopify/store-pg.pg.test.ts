// @vitest-environment node
//
// The connected store in Postgres. Runs ONLY on a throwaway database:
// DATABASE_URL=postgres://postgres@127.0.0.1:5562/openlen, migrated with scripts/shopify-migrate.ts.
import { afterAll, beforeAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";

import { pgShopifyStore } from "./store-pg";
import { describeShopifyStoreContract } from "./store-contract";

const PERSON = "test-shopify-person";
const A = "test-shopify-project-a";
const B = "test-shopify-project-b";

async function fresh(): Promise<void> {
  for (const id of [A, B]) {
    await db.delete(schema.projects).where(eq(schema.projects.id, id));
    await db.insert(schema.projects).values({ id, userId: PERSON, title: "shopify", brief: "", data: { html: "<p>x</p>" } });
  }
}

beforeAll(async () => {
  await exigirBaseLocal();
  await db.insert(schema.users).values({ id: PERSON, email: `${PERSON}@example.invalid`, name: PERSON }).onConflictDoNothing();
});
beforeEach(fresh);
afterAll(async () => {
  for (const id of [A, B]) await db.delete(schema.projects).where(eq(schema.projects.id, id));
  await db.delete(schema.users).where(eq(schema.users.id, PERSON));
});

describeShopifyStoreContract("pgShopifyStore", async () => ({ store: pgShopifyStore, projectA: A, projectB: B, person: PERSON }));
