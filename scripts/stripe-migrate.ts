// Stripe (spec local 2026-10-21-stripe-integration, §7): the account behind each
// environment's key and the project's Stripe objects with their live twins. Two
// new tables; additive and idempotent. Keep in sync with lib/db/schema.ts.
//
// 🔴 Before the code: `stripeAccounts` and `stripeObjects` are read when a
// project's secrets are saved and when it is published.
//
// Run: npm run stripe:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "stripeAccounts" (
      "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "environment" text NOT NULL CHECK ("environment" IN ('draft', 'live')),
      "accountId" text NOT NULL,
      "accountName" text,
      "keyKind" text NOT NULL CHECK ("keyKind" IN ('sk', 'rk')),
      "chargesEnabled" boolean,
      "checkedAt" timestamp NOT NULL DEFAULT now(),
      PRIMARY KEY ("projectId", "environment")
    );
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "stripeObjects" (
      "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "testId" text NOT NULL,
      "kind" text NOT NULL CHECK ("kind" IN ('product', 'price', 'payment_link', 'shipping_rate', 'portal_configuration', 'webhook_endpoint')),
      "testUrl" text,
      "lookupKey" text,
      "functionName" text,
      "secretName" text,
      "source" text NOT NULL CHECK ("source" IN ('cli', 'files')),
      "liveId" text,
      "liveUrl" text,
      "fingerprint" text,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "syncedAt" timestamp,
      PRIMARY KEY ("projectId", "testId")
    );
  `);
  console.log("stripe: stripeAccounts and stripeObjects ready");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
