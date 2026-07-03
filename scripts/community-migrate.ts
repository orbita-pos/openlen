// Scoped DDL for the community/explore feature — used instead of db:push so
// the full-schema push doesn't stop on unrelated drift. Keep in sync with
// lib/db/schema.ts (users extra cols, projects extra cols, pageReports).
//
// Run: npm run community:migrate

import { sql } from "drizzle-orm";
import { db } from "../lib/db";

async function main() {
  await db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "handle" text;`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "users_handle_uq" ON "users" ("handle");`);
  await db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bio" text;`);
  await db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatarUrl" text;`);

  await db.execute(sql`ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "visibility" text NOT NULL DEFAULT 'private';`);
  await db.execute(sql`ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "remixedFromId" text;`);
  await db.execute(sql`ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "remixCount" integer NOT NULL DEFAULT 0;`);
  await db.execute(sql`ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "listedAt" timestamp;`);
  await db.execute(sql`DO $$ BEGIN
    ALTER TABLE "projects" ADD CONSTRAINT "projects_remixedFromId_fk"
      FOREIGN KEY ("remixedFromId") REFERENCES "projects"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "projects_visibility_listedAt_idx" ON "projects" ("visibility","listedAt");`);

  await db.execute(sql`CREATE TABLE IF NOT EXISTS "pageReports" (
    "id" text PRIMARY KEY NOT NULL,
    "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "reason" text NOT NULL,
    "note" text,
    "reporterUaHash" text,
    "status" text NOT NULL DEFAULT 'open',
    "createdAt" timestamp DEFAULT now() NOT NULL
  );`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "pageReports_status_createdAt_idx" ON "pageReports" ("status","createdAt");`);

  console.log("community schema ready.");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
