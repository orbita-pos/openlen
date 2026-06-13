// Create the Broadcast-module tables (idempotent) — broadcasts +
// broadcastRecipients + emailSuppressions. Used instead of `db:push` because
// the full-schema push stops on an UNRELATED pending prompt; this applies
// ONLY the broadcast DDL. Keep in sync with lib/db/schema.ts.
//
// Run: npm run broadcast:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS "broadcasts" (
      "id" text PRIMARY KEY,
      "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "subject" text NOT NULL,
      "body" text NOT NULL,
      "status" text NOT NULL DEFAULT 'draft',
      "audienceCount" integer,
      "sentCount" integer,
      "failedCount" integer,
      "failureReason" text,
      "sentAt" timestamp,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    );`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "broadcasts_projectId_createdAt_idx"
      ON "broadcasts" ("projectId", "createdAt");`,
  );

  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS "broadcastRecipients" (
      "id" text PRIMARY KEY,
      "broadcastId" text NOT NULL REFERENCES "broadcasts"("id") ON DELETE CASCADE,
      "memberId" text,
      "email" text NOT NULL,
      "status" text NOT NULL,
      "createdAt" timestamp NOT NULL DEFAULT now()
    );`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "broadcastRecipients_broadcastId_idx"
      ON "broadcastRecipients" ("broadcastId");`,
  );

  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS "emailSuppressions" (
      "id" text PRIMARY KEY,
      "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "email" text NOT NULL,
      "reason" text NOT NULL DEFAULT 'unsubscribed',
      "createdAt" timestamp NOT NULL DEFAULT now()
    );`,
  );
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "emailSuppressions_projectId_email_uq"
      ON "emailSuppressions" ("projectId", "email");`,
  );

  console.log("broadcast tables ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
