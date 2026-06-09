// Create the flightReports table (idempotent). Used instead of `db:push`
// because the full-schema push stops on an unrelated pending prompt; this
// applies ONLY the Flight Check DDL. Keep in sync with the Drizzle
// `flightReports` definition in lib/db/schema.ts.
//
// Run: npm run flight:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS "flightReports" (
      "id" text PRIMARY KEY,
      "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "subdomain" text NOT NULL,
      "releaseSha" text NOT NULL,
      "perfScore" integer,
      "a11yScore" integer,
      "bpScore" integer,
      "seoScore" integer,
      "lcpMs" integer,
      "cls" real,
      "tbtMs" integer,
      "fcpMs" integer,
      "speedIndexMs" integer,
      "totalBytes" integer,
      "requestCount" integer,
      "details" jsonb,
      "createdAt" timestamp NOT NULL DEFAULT now()
    );`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "flightReports_projectId_createdAt_idx"
      ON "flightReports" ("projectId", "createdAt");`,
  );
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "flightReports_projectId_releaseSha_idx"
      ON "flightReports" ("projectId", "releaseSha");`,
  );

  console.log("flightReports table ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
