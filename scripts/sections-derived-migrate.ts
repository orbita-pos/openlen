import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(sql`
    ALTER TABLE "sections"
      ADD COLUMN IF NOT EXISTS "provenance" jsonb,
      ADD COLUMN IF NOT EXISTS "derivedSemantics" jsonb;
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "sections_derived_source_idx"
      ON "sections" (("provenance"->>'sourceTemplateId'))
      WHERE "provenance" IS NOT NULL;
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "templateDerivedCanaryRuns" (
      "id" text PRIMARY KEY, "runId" text NOT NULL, "caseId" text NOT NULL,
      "ok" boolean NOT NULL, "resultCode" text NOT NULL,
      "costMicromxn" integer NOT NULL CHECK ("costMicromxn" >= 0),
      "durationMs" integer NOT NULL CHECK ("durationMs" >= 0),
      "createdAt" timestamp with time zone NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "templateDerivedCanaryRuns_run_idx" ON "templateDerivedCanaryRuns" ("runId", "createdAt");
  `);
  console.log("derived section provenance ready.");
}

main().catch((error) => {
  console.error("sections-derived-migrate failed");
  process.exitCode = 1;
});
