// Idempotent DDL for the Marketing Kit post-template catalog. Scoped script
// instead of db:generate (full-snapshot landmine — see CLAUDE.md gotchas).
// Run: npm run post-templates:migrate

import { sql } from "drizzle-orm";
import { db } from "../lib/db";

async function main() {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "postTemplates" (
    "id" text PRIMARY KEY,
    "name" text NOT NULL,
    "register" text NOT NULL,
    "format" text NOT NULL,
    "goal" text NOT NULL,
    "storageKey" text NOT NULL,
    "storageUrl" text NOT NULL,
    "contentHash" text NOT NULL,
    "size" integer NOT NULL,
    "status" text NOT NULL DEFAULT 'draft',
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "updatedAt" timestamp NOT NULL DEFAULT now(),
    "publishedAt" timestamp
  );`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "postTemplates_register_status_idx"
    ON "postTemplates" ("register", "status");`);
  console.log("postTemplates table ready.");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
