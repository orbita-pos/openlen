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
  console.log("derived section provenance ready.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "sections-derived-migrate failed");
  process.exitCode = 1;
});
