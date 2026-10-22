// Project email (spec local 2026-10-22-email-integration, §7): each project's
// sending domain, what it sent, each account's month and OpenLen's switch (four
// new tables), plus the suppression list that already existed. Additive and
// idempotent. Keep in sync with lib/db/schema.ts.
//
// 🔴 Before the code: sending, the Correos tab and the sign-in emails read them.
//
// Run: npm run email:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "emailDomains" (
      "projectId" text PRIMARY KEY REFERENCES "projects"("id") ON DELETE CASCADE,
      "domain" text NOT NULL,
      "sendingHost" text NOT NULL UNIQUE,
      "showAsRoot" boolean NOT NULL DEFAULT false,
      "resendDomainId" text NOT NULL,
      "records" jsonb NOT NULL,
      "status" text NOT NULL CHECK ("status" IN ('pending', 'verifying', 'ready', 'failed', 'offline')),
      "lastCheckedAt" timestamp,
      "verifiedAt" timestamp,
      "createdAt" timestamp NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "emailMessages" (
      "id" text PRIMARY KEY,
      "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "ownerId" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "environment" text NOT NULL CHECK ("environment" IN ('draft', 'live')),
      "kind" text NOT NULL CHECK ("kind" IN ('app', 'auth', 'form')),
      "toAddress" text NOT NULL,
      "subject" text NOT NULL,
      "status" text NOT NULL CHECK ("status" IN ('sent', 'delivered', 'bounced', 'complained', 'rejected', 'not_sent_draft')),
      "reason" text,
      "resendId" text,
      "tag" text,
      "createdAt" timestamp NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "emailMessages_project_idx" ON "emailMessages" ("projectId", "createdAt");`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "emailMessages_owner_idx" ON "emailMessages" ("ownerId", "kind", "createdAt");`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "emailMessages_resend_idx" ON "emailMessages" ("resendId");`);
  // The suppression list already exists (lib/db/schema.ts, from the broadcasts): same shape here
  // where it doesn't, so the unsubscribes of before keep counting.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "emailSuppressions" (
      "id" text PRIMARY KEY,
      "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "email" text NOT NULL,
      "reason" text NOT NULL DEFAULT 'unsubscribed',
      "createdAt" timestamp NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "emailSuppressions_projectId_email_uq" ON "emailSuppressions" ("projectId", "email");`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "emailUsage" (
      "ownerId" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "month" text NOT NULL,
      "sent" integer NOT NULL DEFAULT 0,
      PRIMARY KEY ("ownerId", "month")
    );
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "emailBlocks" (
      "scope" text NOT NULL CHECK ("scope" IN ('project', 'owner')),
      "id" text NOT NULL,
      "reason" text NOT NULL,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      PRIMARY KEY ("scope", "id")
    );
  `);
  console.log("email: emailDomains, emailMessages, emailSuppressions, emailUsage and emailBlocks ready");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
