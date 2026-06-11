// Add the multipage drift column to `projects` directly (idempotent).
// Used instead of `db:push` because the full-schema push stops on an UNRELATED
// pending prompt; this applies ONLY this DDL. Keep in sync with the Drizzle
// `projects` definition in lib/db/schema.ts.
//
// Run: npm run drift:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(
    sql`ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "publishedPagesHash" text;`,
  );

  console.log("projects.publishedPagesHash ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
