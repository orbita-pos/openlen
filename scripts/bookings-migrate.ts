// Create the Bookings-module tables (idempotent) — bookableServices, bookings,
// bookingEvents + the no-double-booking guard. Used instead of `db:push`
// because the full-schema push stops on unrelated drift; this applies ONLY the
// bookings DDL. Keep in sync with lib/db/schema.ts.
//
// Run: npm run bookings:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS "bookableServices" (
      "id" text PRIMARY KEY,
      "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "name" text NOT NULL,
      "description" text,
      "durationMin" integer NOT NULL,
      "slotIncrementMin" integer NOT NULL DEFAULT 0,
      "bufferBeforeMin" integer NOT NULL DEFAULT 0,
      "bufferAfterMin" integer NOT NULL DEFAULT 0,
      "minLeadTimeMin" integer NOT NULL DEFAULT 0,
      "maxDaysAhead" integer NOT NULL DEFAULT 30,
      "creatorTz" text NOT NULL,
      "weeklyHours" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "exceptions" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "capacity" integer NOT NULL DEFAULT 1,
      "priceDisplay" text,
      "locationText" text,
      "status" text NOT NULL DEFAULT 'active',
      "sortOrder" integer NOT NULL DEFAULT 0,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    );`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "bookableServices_projectId_idx"
      ON "bookableServices" ("projectId", "status");`,
  );

  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS "bookings" (
      "id" text PRIMARY KEY,
      "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "serviceId" text NOT NULL REFERENCES "bookableServices"("id") ON DELETE CASCADE,
      "startUtc" timestamptz NOT NULL,
      "endUtc" timestamptz NOT NULL,
      "seatNo" integer NOT NULL DEFAULT 0,
      "status" text NOT NULL DEFAULT 'pending',
      "memberId" text,
      "guestName" text,
      "guestEmail" text,
      "note" text,
      "creatorTz" text NOT NULL,
      "visitorTz" text,
      "rescheduledFromId" text,
      "rescheduledToId" text,
      "reminderStage" integer NOT NULL DEFAULT 0,
      "icsSequence" integer NOT NULL DEFAULT 0,
      "cancelledAt" timestamptz,
      "createdAt" timestamp NOT NULL DEFAULT now()
    );`,
  );
  // THE GUARD — at most one live booking per (service, instant, seat).
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "bookings_slot_uq"
      ON "bookings" ("serviceId", "startUtc", "seatNo")
      WHERE status IN ('confirmed','pending');`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "bookings_projectId_startUtc_idx"
      ON "bookings" ("projectId", "startUtc");`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "bookings_serviceId_startUtc_idx"
      ON "bookings" ("serviceId", "startUtc");`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "bookings_status_startUtc_idx"
      ON "bookings" ("status", "startUtc");`,
  );

  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS "bookingEvents" (
      "id" text PRIMARY KEY,
      "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "bookingId" text NOT NULL,
      "type" text NOT NULL,
      "actor" text NOT NULL,
      "detail" jsonb,
      "createdAt" timestamp NOT NULL DEFAULT now()
    );`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "bookingEvents_bookingId_idx"
      ON "bookingEvents" ("bookingId", "createdAt");`,
  );

  console.log("bookings tables ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
