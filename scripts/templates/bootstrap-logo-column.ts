// One-shot bootstrap: add `logoUrl` column to the projects table.
// Idempotent — re-runs are safe.

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

async function main(): Promise<void> {
  await db.execute(
    sql.raw(`ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "logoUrl" text`),
  );
  // eslint-disable-next-line no-console
  console.log(`✓ projects.logoUrl column ensured`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
