// One-shot bootstrap: add `screenshotUrl` column to the templates table.
// Idempotent — re-runs are safe. Mirrors bootstrap-thumbnail-column.ts.
//
// This is the surgical, additive path the team uses for new template
// columns (vs `db:push --force`, which diffs the whole schema). The column
// is nullable, so existing rows are untouched until
// `templates:capture-screenshots` populates them.

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

async function main(): Promise<void> {
  await db.execute(
    sql.raw(`ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "screenshotUrl" text`),
  );
  // eslint-disable-next-line no-console
  console.log(`✓ templates.screenshotUrl column ensured`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
