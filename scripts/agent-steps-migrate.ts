// Layer 0 of Len 3.1 (spec local 2026-10-24-len-3-1-layers-0-1, §4.1): one row per
// model call of Len (one new table). Additive and idempotent. Keep in sync with
// lib/db/schema.ts (`agentRequestSteps`).
//
// 🔴 Before the code: the agent route writes it on every model call.
//
// Run: npm run agent-steps:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "agentRequestSteps" (
      "id" text PRIMARY KEY,
      "projectId" text NOT NULL,
      "turnId" text NOT NULL,
      "step" integer NOT NULL,
      "kind" text NOT NULL,
      "provider" text NOT NULL,
      "model" text NOT NULL,
      "effort" text,
      "startedAt" timestamp NOT NULL,
      "durationMs" integer NOT NULL,
      "inputTokens" integer,
      "cachedTokens" integer,
      "outputTokens" integer,
      "reasoningTokens" integer,
      "systemHash" text,
      "toolsHash" text,
      "prefixHash" text NOT NULL,
      "messageCount" integer NOT NULL,
      "turnFirstMessageCount" integer,
      "messageHashes" jsonb,
      "tools" jsonb,
      "repeats" jsonb,
      "cacheBreak" jsonb,
      "endReason" text,
      "createdAt" timestamp NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "agentRequestSteps_projectId_kind_createdAt_idx"
      ON "agentRequestSteps" ("projectId", "kind", "createdAt");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "agentRequestSteps_createdAt_idx" ON "agentRequestSteps" ("createdAt");
  `);
  console.log("agent-steps: agentRequestSteps ready");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
