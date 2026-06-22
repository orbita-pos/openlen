// Add the funnel columns (idempotent) — pageEvents.cid + pageEvents.source +
// its join index, and bookings.cid. Used instead of `db:push` because the
// full-schema push stops on unrelated drift; this applies ONLY the funnel DDL.
// Keep in sync with lib/db/schema.ts (pageEvents / bookings).
//
// formSubmissions.cid needs no DDL — it lives inside the existing `meta` jsonb.
//
// Run: npm run analytics:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(
    sql`ALTER TABLE "pageEvents" ADD COLUMN IF NOT EXISTS "cid" text;`,
  );
  await db.execute(
    sql`ALTER TABLE "pageEvents" ADD COLUMN IF NOT EXISTS "source" jsonb;`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "pageEvents_projectId_cid_idx"
      ON "pageEvents" ("projectId", "cid");`,
  );
  await db.execute(
    sql`ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "cid" text;`,
  );

  console.log("analytics funnel columns ready (pageEvents.cid/source, bookings.cid).");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
