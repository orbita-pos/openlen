// One-shot bootstrap: add `tileUrl` column to the templates table.
// Idempotent — re-runs are safe. Mirrors bootstrap-thumbnail-column.ts.

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

async function main(): Promise<void> {
  await db.execute(
    sql.raw(`ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "tileUrl" text`),
  );
  // eslint-disable-next-line no-console
  console.log(`✓ templates.tileUrl column ensured`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
