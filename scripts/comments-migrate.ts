// Create the Comments-module table (idempotent) — siteComments. Used instead
// of `db:push` because the full-schema push stops on unrelated drift; this
// applies ONLY the comments DDL. Keep in sync with lib/db/schema.ts.
//
// Run: npm run comments:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS "siteComments" (
      "id" text PRIMARY KEY,
      "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "page" text,
      "memberId" text,
      "authorName" text,
      "authorEmail" text,
      "body" text NOT NULL,
      "parentId" text,
      "status" text NOT NULL DEFAULT 'hidden',
      "createdAt" timestamp NOT NULL DEFAULT now()
    );`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "siteComments_projectId_page_createdAt_idx"
      ON "siteComments" ("projectId", "page", "createdAt");`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "siteComments_projectId_status_idx"
      ON "siteComments" ("projectId", "status");`,
  );

  console.log("siteComments table ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
