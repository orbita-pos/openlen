// One-shot bootstrap: add `thumbnailUrl` column to the templates table.
// Idempotent — re-runs are safe.

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

async function main(): Promise<void> {
  await db.execute(
    sql.raw(`ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "thumbnailUrl" text`),
  );
  // eslint-disable-next-line no-console
  console.log(`✓ templates.thumbnailUrl column ensured`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
