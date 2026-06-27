// Create the Web Push notification tables (idempotent). Applied instead of
// db:push to avoid touching unrelated pending schema drift. Keep in sync with
// the Drizzle defs in lib/db/schema.ts. Run: npm run notifications:migrate

import { sql } from "drizzle-orm";
import { db } from "../lib/db";

async function main() {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "pushSubscriptions" (
    "endpoint" text PRIMARY KEY,
    "userId" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "p256dh" text NOT NULL,
    "auth" text NOT NULL,
    "userAgent" text,
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "lastUsedAt" timestamp
  );`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "pushSubscriptions_userId_idx"
    ON "pushSubscriptions" ("userId");`);

  await db.execute(sql`CREATE TABLE IF NOT EXISTS "notificationPreferences" (
    "userId" text PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
    "webPushEnabled" boolean NOT NULL DEFAULT true,
    "emailEnabled" boolean NOT NULL DEFAULT true,
    "quietFrom" text,
    "quietUntil" text,
    "timezone" text NOT NULL DEFAULT 'America/Lima',
    "updatedAt" timestamp NOT NULL DEFAULT now()
  );`);

  await db.execute(sql`CREATE TABLE IF NOT EXISTS "notificationDeliveries" (
    "id" text PRIMARY KEY,
    "userId" text NOT NULL,
    "channel" text NOT NULL,
    "status" text NOT NULL,
    "eventType" text NOT NULL,
    "conversationId" text,
    "detail" text,
    "createdAt" timestamp NOT NULL DEFAULT now()
  );`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "notificationDeliveries_userId_createdAt_idx"
    ON "notificationDeliveries" ("userId", "createdAt");`);

  await db.execute(sql`CREATE TABLE IF NOT EXISTS "notificationJobs" (
    "id" text PRIMARY KEY,
    "dedupeKey" text,
    "payload" jsonb NOT NULL,
    "status" text NOT NULL DEFAULT 'pending',
    "attempts" integer NOT NULL DEFAULT 0,
    "runAfter" timestamp NOT NULL DEFAULT now(),
    "lastError" text,
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "updatedAt" timestamp NOT NULL DEFAULT now()
  );`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "notificationJobs_status_runAfter_idx"
    ON "notificationJobs" ("status", "runAfter");`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "notificationJobs_dedupe_pending_uq"
    ON "notificationJobs" ("dedupeKey") WHERE status = 'pending' AND "dedupeKey" IS NOT NULL;`);

  console.log("notification tables ready.");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
