// Create the `businessProfiles` table + add `projects.profileId` directly
// (idempotent). Used instead of `db:push` because the full-schema push stops on
// an UNRELATED pending prompt (customDomains drift); this applies ONLY the
// business-profile DDL. Keep in sync with lib/db/schema.ts.
//
// Run: npm run businessProfiles:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "businessProfiles" (
      "id" text PRIMARY KEY NOT NULL,
      "userId" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "name" text NOT NULL,
      "data" jsonb NOT NULL,
      "isDefault" boolean DEFAULT false NOT NULL,
      "createdAt" timestamp DEFAULT now() NOT NULL,
      "updatedAt" timestamp DEFAULT now() NOT NULL
    );
  `);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "businessProfiles_userId_idx" ON "businessProfiles" ("userId");`,
  );

  // Collapse any pre-existing duplicate defaults (keep the most recent) so the
  // partial unique index can be created, then enforce one default per user.
  await db.execute(sql`
    UPDATE "businessProfiles" b SET "isDefault" = false
    WHERE "isDefault" = true AND "id" <> (
      SELECT b2."id" FROM "businessProfiles" b2
      WHERE b2."userId" = b."userId" AND b2."isDefault" = true
      ORDER BY b2."updatedAt" DESC, b2."id" DESC
      LIMIT 1
    );
  `);
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "businessProfiles_userId_default_uq" ON "businessProfiles" ("userId") WHERE "isDefault";`,
  );

  await db.execute(
    sql`ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "profileId" text;`,
  );
  // ADD CONSTRAINT has no IF NOT EXISTS — guard on the catalog so re-runs are
  // safe (ON DELETE SET NULL: deleting a profile just clears the link).
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'projects_profileId_fk'
      ) THEN
        ALTER TABLE "projects"
          ADD CONSTRAINT "projects_profileId_fk"
          FOREIGN KEY ("profileId") REFERENCES "businessProfiles"("id") ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  console.log("businessProfiles table + projects.profileId ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
