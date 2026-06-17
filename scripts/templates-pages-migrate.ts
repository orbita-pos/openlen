// Add the `pages` column to `templates` (multi-page templates) directly +
// idempotently. Used instead of `db:push` because the full-schema push stops
// on UNRELATED pending prompts; this applies ONLY this DDL. Keep in sync with
// the Drizzle `templates` definition in lib/db/schema.ts.
//
// Run: npm run templates:pages-migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(
    sql`ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "pages" jsonb DEFAULT '[]'::jsonb;`,
  );

  console.log("templates.pages ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
