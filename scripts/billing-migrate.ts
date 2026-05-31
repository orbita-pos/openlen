// Add the Polar billing columns to the `users` table directly (idempotent).
// Used instead of `db:push` because the full-schema push stops on an UNRELATED
// pending prompt; this applies ONLY the billing DDL. Keep in sync with the
// Drizzle `users` definition in lib/db/schema.ts.
//
// Run: npm run billing:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(
    sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "polarCustomerId" text;`,
  );
  await db.execute(
    sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "polarSubscriptionId" text;`,
  );
  await db.execute(
    sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "subscriptionStatus" text;`,
  );

  // Webhook idempotency ledger — see lib/db/schema.ts processedWebhooks.
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS "processedWebhooks" (
      "id" text PRIMARY KEY,
      "receivedAt" timestamp NOT NULL DEFAULT now()
    );`,
  );

  console.log("users billing columns ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
