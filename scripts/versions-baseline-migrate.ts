// Add the isBaseline column to `projectVersions` directly (idempotent).
// Keep in sync with the Drizzle definition in lib/db/schema.ts.
//
// Run: npm run versions:baseline:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(
    sql`ALTER TABLE "projectVersions" ADD COLUMN IF NOT EXISTS "isBaseline" boolean NOT NULL DEFAULT false;`,
  );

  console.log("projectVersions isBaseline column ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
