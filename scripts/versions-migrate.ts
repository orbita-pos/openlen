// Add the multi-page + pin columns to `projectVersions` directly (idempotent).
// Used instead of `db:push` because the full-schema push stops on an UNRELATED
// pending prompt; this applies ONLY the versions DDL. Keep in sync with the
// Drizzle `projectVersions` definition in lib/db/schema.ts.
//
// Run: npm run versions:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(
    sql`ALTER TABLE "projectVersions" ADD COLUMN IF NOT EXISTS "page" text;`,
  );
  await db.execute(
    sql`ALTER TABLE "projectVersions" ADD COLUMN IF NOT EXISTS "pinned" boolean NOT NULL DEFAULT false;`,
  );

  console.log("projectVersions page/pinned columns ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
