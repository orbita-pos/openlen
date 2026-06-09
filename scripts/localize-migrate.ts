// Create the projectTranslations table (idempotent). Used instead of
// `db:push` because the full-schema push stops on an unrelated pending
// prompt; this applies ONLY the Speak Every Language DDL. Keep in sync
// with the Drizzle `projectTranslations` definition in lib/db/schema.ts.
//
// Run: npm run localize:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS "projectTranslations" (
      "id" text PRIMARY KEY,
      "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "locale" text NOT NULL,
      "entries" jsonb NOT NULL,
      "updatedAt" timestamp NOT NULL DEFAULT now()
    );`,
  );
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "projectTranslations_projectId_locale_idx"
      ON "projectTranslations" ("projectId", "locale");`,
  );

  console.log("projectTranslations table ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
