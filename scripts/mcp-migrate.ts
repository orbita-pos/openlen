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
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "mcpAudit" (
    "id" text PRIMARY KEY,
    "userId" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "tokenId" text NOT NULL,
    "tool" text NOT NULL,
    "projectId" text,
    "ok" boolean NOT NULL,
    "errorCode" text,
    "durationMs" integer NOT NULL,
    "createdAt" timestamp NOT NULL DEFAULT now()
  );`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "mcpAudit_userId_createdAt_idx" ON "mcpAudit" ("userId", "createdAt");`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "mcpApprovals" (
    "id" text PRIMARY KEY,
    "userId" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "tokenId" text NOT NULL,
    "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "action" text NOT NULL,
    "subdomain" text,
    "status" text NOT NULL DEFAULT 'pending',
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "expiresAt" timestamp NOT NULL,
    "decidedAt" timestamp,
    "usedAt" timestamp
  );`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "mcpApprovals_userId_idx" ON "mcpApprovals" ("userId");`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "mcpApprovals_trust_idx" ON "mcpApprovals" ("tokenId", "projectId", "action", "subdomain", "status");`);
  // OAUTH (Parte 3): la familia en los tokens, los clientes, las peticiones y los refresh.
  await db.execute(sql`ALTER TABLE "mcpTokens" ADD COLUMN IF NOT EXISTS "familyId" text;`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "mcpTokens_familyId_idx" ON "mcpTokens" ("familyId");`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "mcpOauthClients" (
    "id" text PRIMARY KEY,
    "kind" text NOT NULL,
    "name" text NOT NULL,
    "redirectUris" jsonb NOT NULL,
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "fetchedAt" timestamp,
    "lastUsedAt" timestamp
  );`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "mcpOauthRequests" (
    "id" text PRIMARY KEY,
    "clientId" text NOT NULL REFERENCES "mcpOauthClients"("id") ON DELETE CASCADE,
    "redirectUri" text NOT NULL,
    "state" text,
    "codeChallenge" text NOT NULL,
    "scopes" jsonb NOT NULL,
    "resource" text,
    "status" text NOT NULL DEFAULT 'pending',
    "userId" text REFERENCES "users"("id") ON DELETE CASCADE,
    "grantedScopes" jsonb,
    "projectId" text REFERENCES "projects"("id") ON DELETE CASCADE,
    "codeHash" text,
    "codeExpiresAt" timestamp,
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "expiresAt" timestamp NOT NULL
  );`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "mcpOauthRequests_codeHash_uq" ON "mcpOauthRequests" ("codeHash");`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "mcpRefreshTokens" (
    "id" text PRIMARY KEY,
    "hash" text NOT NULL,
    "familyId" text NOT NULL,
    "userId" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "clientId" text NOT NULL,
    "scopes" jsonb NOT NULL,
    "projectId" text REFERENCES "projects"("id") ON DELETE CASCADE,
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "expiresAt" timestamp NOT NULL,
    "rotatedAt" timestamp,
    "revokedAt" timestamp
  );`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "mcpRefreshTokens_hash_uq" ON "mcpRefreshTokens" ("hash");`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "mcpRefreshTokens_familyId_idx" ON "mcpRefreshTokens" ("familyId");`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "mcpRefreshTokens_userId_idx" ON "mcpRefreshTokens" ("userId");`);
  console.log("tablas del MCP listas.");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
