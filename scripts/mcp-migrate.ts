// La tabla de tokens del servidor MCP (idempotente). Como los demás *-migrate:
// en vez de db:push, para no tocar otra deriva pendiente. Mantener en sintonía
// con lib/db/schema.ts (mcpTokens). Run: npm run mcp:migrate

import { sql } from "drizzle-orm";
import { db } from "../lib/db";

async function main() {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "mcpTokens" (
    "id" text PRIMARY KEY,
    "hash" text NOT NULL,
    "userId" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "kind" text NOT NULL,
    "name" text NOT NULL,
    "scopes" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "projectId" text REFERENCES "projects"("id") ON DELETE CASCADE,
    "clientId" text,
    "expiresAt" timestamp,
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "lastUsedAt" timestamp,
    "revokedAt" timestamp
  );`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "mcpTokens_hash_uq" ON "mcpTokens" ("hash");`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "mcpTokens_userId_idx" ON "mcpTokens" ("userId");`);
  console.log("tabla mcpTokens lista.");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
