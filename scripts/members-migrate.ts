// Create the Members-module tables (idempotent) — siteMembers + memberLoginTokens.
// Used instead of `db:push` because the full-schema push stops on an UNRELATED
// pending prompt; this applies ONLY the members DDL. Keep in sync with the
// Drizzle definitions in lib/db/schema.ts.
//
// Run: npm run members:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS "siteMembers" (
      "id" text PRIMARY KEY,
      "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "email" text NOT NULL,
      "name" text,
      "status" text NOT NULL DEFAULT 'active',
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "lastLoginAt" timestamp
    );`,
  );
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "siteMembers_projectId_email_uq"
      ON "siteMembers" ("projectId", "email");`,
  );

  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS "memberLoginTokens" (
      "tokenHash" text PRIMARY KEY,
      "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "email" text NOT NULL,
      "slug" text,
      "expires" timestamp NOT NULL,
      "used" boolean NOT NULL DEFAULT false,
      "createdAt" timestamp NOT NULL DEFAULT now()
    );`,
  );

  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS "memberSessions" (
      "tokenHash" text PRIMARY KEY,
      "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "memberId" text NOT NULL REFERENCES "siteMembers"("id") ON DELETE CASCADE,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "lastSeenAt" timestamp NOT NULL DEFAULT now(),
      "expiresAt" timestamp NOT NULL
    );`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "memberSessions_memberId_idx"
      ON "memberSessions" ("memberId");`,
  );

  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS "memberAuthEvents" (
      "id" text PRIMARY KEY,
      "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "memberId" text,
      "email" text,
      "type" text NOT NULL,
      "createdAt" timestamp NOT NULL DEFAULT now()
    );`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "memberAuthEvents_projectId_createdAt_idx"
      ON "memberAuthEvents" ("projectId", "createdAt");`,
  );

  console.log("members tables ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
