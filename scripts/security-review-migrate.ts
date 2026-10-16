// The security review at publish (spec local 2026-10-15-security-review-design):
// the tables securityReviews and securityAcceptances. New tables with IF NOT
// EXISTS, so it is additive and idempotent. Keep in sync with lib/db/schema.ts.
//
// Run: npm run security-review:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "securityReviews" (
      "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "fingerprint" text NOT NULL,
      "status" text NOT NULL CHECK ("status" IN ('running', 'done', 'failed', 'skipped_budget', 'skipped_scope')),
      "phase0" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "findings" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "fileHashes" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "costCentiCredits" integer NOT NULL DEFAULT 0,
      "failReason" text,
      "startedAt" timestamp NOT NULL DEFAULT now(),
      "finishedAt" timestamp,
      "shownToAgentAt" timestamp,
      "acceptedBy" text,
      "acceptedAt" timestamp,
      "publishedAt" timestamp,
      "baseFiles" jsonb,
      PRIMARY KEY ("projectId", "fingerprint")
    );
  `);
  // For a database where the table already existed without them.
  await db.execute(sql`ALTER TABLE "securityReviews" ADD COLUMN IF NOT EXISTS "publishedAt" timestamp;`);
  await db.execute(sql`ALTER TABLE "securityReviews" ADD COLUMN IF NOT EXISTS "baseFiles" jsonb;`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "securityReviews_started_idx" ON "securityReviews" ("startedAt");`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "securityAcceptances" (
      "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "key" text NOT NULL,
      "finding" jsonb NOT NULL,
      "acceptedBy" text NOT NULL,
      "acceptedAt" timestamp NOT NULL DEFAULT now(),
      PRIMARY KEY ("projectId", "key")
    );
  `);
  console.log("[security-review:migrate] securityReviews and securityAcceptances ready");
  process.exit(0);
}

main().catch((err) => {
  console.error("[security-review:migrate] failed", err);
  process.exit(1);
});
