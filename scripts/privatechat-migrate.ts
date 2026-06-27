// Create the Private Chat module tables (idempotent). Used instead of db:push
// because the full-schema push stops on an UNRELATED pending prompt; this
// applies ONLY the chat DDL. Keep in sync with the Drizzle defs in
// lib/db/schema.ts. NOTE: the `chat:migrate` script is a DIFFERENT, unrelated
// migration (projectChatMessages). Run: npm run privatechat:migrate

import { sql } from "drizzle-orm";
import { db } from "../lib/db";

async function main() {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "chatUsers" (
    "id" text PRIMARY KEY,
    "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "username" text NOT NULL,
    "passwordHash" text NOT NULL,
    "email" text,
    "displayName" text,
    "role" text NOT NULL DEFAULT 'member',
    "status" text NOT NULL DEFAULT 'active',
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "lastSeenAt" timestamp
  );`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "chatUsers_projectId_username_uq"
    ON "chatUsers" ("projectId", "username");`);

  await db.execute(sql`CREATE TABLE IF NOT EXISTS "chatSessions" (
    "tokenHash" text PRIMARY KEY,
    "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "chatUserId" text NOT NULL REFERENCES "chatUsers"("id") ON DELETE CASCADE,
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "lastSeenAt" timestamp NOT NULL DEFAULT now(),
    "expiresAt" timestamp NOT NULL
  );`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "chatSessions_chatUserId_idx"
    ON "chatSessions" ("chatUserId");`);

  await db.execute(sql`CREATE TABLE IF NOT EXISTS "chatConversations" (
    "id" text PRIMARY KEY,
    "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "aUserId" text NOT NULL,
    "bUserId" text NOT NULL,
    "lastMessageAt" timestamp,
    "createdAt" timestamp NOT NULL DEFAULT now()
  );`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "chatConversations_pair_uq"
    ON "chatConversations" ("projectId", "aUserId", "bUserId");`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "chatConversations_a_idx" ON "chatConversations" ("aUserId");`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "chatConversations_b_idx" ON "chatConversations" ("bUserId");`);
  // Read-receipt columns (idempotent) — added in P5 Task 2.
  await db.execute(sql`ALTER TABLE "chatConversations" ADD COLUMN IF NOT EXISTS "aReadAt" timestamp;`);
  await db.execute(sql`ALTER TABLE "chatConversations" ADD COLUMN IF NOT EXISTS "bReadAt" timestamp;`);

  await db.execute(sql`CREATE TABLE IF NOT EXISTS "chatMessages" (
    "id" text PRIMARY KEY,
    "conversationId" text NOT NULL REFERENCES "chatConversations"("id") ON DELETE CASCADE,
    "authorId" text NOT NULL,
    "body" text NOT NULL,
    "createdAt" timestamp(3) NOT NULL DEFAULT now(),
    "readAt" timestamp
  );`);
  await db.execute(sql`ALTER TABLE "chatMessages" ALTER COLUMN "createdAt" TYPE timestamp(3);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "chatMessages_conversation_created_idx"
    ON "chatMessages" ("conversationId", "createdAt");`);

  await db.execute(sql`CREATE TABLE IF NOT EXISTS "chatEvents" (
    "id" text PRIMARY KEY,
    "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "chatUserId" text,
    "type" text NOT NULL,
    "createdAt" timestamp NOT NULL DEFAULT now()
  );`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "chatEvents_projectId_createdAt_idx"
    ON "chatEvents" ("projectId", "createdAt");`);

  await db.execute(sql`CREATE TABLE IF NOT EXISTS "chatAgents" (
    "id" text PRIMARY KEY,
    "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "userId" text REFERENCES "users"("id") ON DELETE CASCADE,
    "invitedEmail" text NOT NULL,
    "status" text NOT NULL DEFAULT 'invited',
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "acceptedAt" timestamp
  );`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "chatAgents_projectId_email_uq"
    ON "chatAgents" ("projectId", "invitedEmail");`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "chatAgents_userId_idx"
    ON "chatAgents" ("userId");`);

  // P5 Task 3: magic-link invite tokens for non-registered emails
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "chatAgentInviteTokens" (
    "tokenHash" text PRIMARY KEY,
    "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "email" text NOT NULL,
    "expires" timestamp NOT NULL,
    "used" boolean NOT NULL DEFAULT false,
    "createdAt" timestamp NOT NULL DEFAULT now()
  );`);

  // P5 Task 4: claim-based assignment columns
  await db.execute(sql`ALTER TABLE "chatConversations" ADD COLUMN IF NOT EXISTS "assignedUserId" text;`);
  await db.execute(sql`ALTER TABLE "chatConversations" ADD COLUMN IF NOT EXISTS "assignedAt" timestamp;`);

  // Unified-identity: guests + member-linked users have no password; memberId links to a site member.
  await db.execute(sql`ALTER TABLE "chatUsers" ALTER COLUMN "passwordHash" DROP NOT NULL;`);
  await db.execute(sql`ALTER TABLE "chatUsers" ADD COLUMN IF NOT EXISTS "memberId" text;`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "chatUsers_memberId_idx" ON "chatUsers" ("memberId");`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "chatUsers_projectId_memberId_uq" ON "chatUsers" ("projectId", "memberId");`);

  console.log("private chat tables ready.");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
