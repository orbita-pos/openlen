// The AI of the apps (spec local 2026-10-15): users.appAiCap and the tables
// appAiSpend and appAiAlerts. Additive and idempotent. Keep in sync with
// lib/db/schema.ts.
//
// 🔴 MANDATORY before the code: Drizzle SELECTS every declared column of
// `users`, so without users.appAiCap signing in fails with "column does not
// exist" (the same failure as agentEffort, see build-migrations.mjs).
//
// Run: npm run app-ai:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "appAiCap" integer;`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "appAiSpend" (
      "userId" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "month" text NOT NULL,
      "projectId" text NOT NULL,
      "environment" text NOT NULL CHECK ("environment" IN ('draft', 'live')),
      "centicredits" integer NOT NULL DEFAULT 0,
      "calls" integer NOT NULL DEFAULT 0,
      PRIMARY KEY ("userId", "month", "projectId", "environment")
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "appAiSpend_project_idx" ON "appAiSpend" ("projectId", "month");
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "appAiAlerts" (
      "userId" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "month" text NOT NULL,
      "percent" integer NOT NULL DEFAULT 0,
      PRIMARY KEY ("userId", "month")
    );
  `);
  console.log("[app-ai:migrate] users.appAiCap, appAiSpend and appAiAlerts ready");
  process.exit(0);
}

main().catch((err) => {
  console.error("[app-ai:migrate] failed", err);
  process.exit(1);
});
