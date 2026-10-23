// Shopify without a key (spec local 2026-10-22-shopify-storefront, §7): the store
// each project sells from (one new table). Additive and idempotent. Keep in sync
// with lib/db/schema.ts.
//
// 🔴 Before the code: connect_shopify_store, Len's PROJECT STATE, the terminal's
// curl and the Shopify tab read it.
//
// Run: npm run shopify:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "shopifyStores" (
      "projectId" text PRIMARY KEY REFERENCES "projects"("id") ON DELETE CASCADE,
      "shopDomain" text NOT NULL,
      "primaryDomain" text NOT NULL,
      "name" text NOT NULL,
      "currency" text NOT NULL,
      "country" text NOT NULL,
      "productsCount" integer NOT NULL,
      "collectionsCount" integer NOT NULL,
      "checkedAt" timestamp NOT NULL,
      "connectedAt" timestamp NOT NULL DEFAULT now(),
      "connectedBy" text REFERENCES "users"("id") ON DELETE SET NULL
    );
  `);
  console.log("shopify: shopifyStores ready");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
