// The SQL of `npm run assistants:migrate`, apart so the PGlite tests create the very same tables
// (lib/assistants/*.pglite.test.ts). Keep in step with lib/db/schema.ts (`assistants`, `assistantProjects`).
// Spec local 2026-11-06-asistente-propio.
export const CREATE_ASSISTANTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS "assistants" (
    "id" text PRIMARY KEY,
    "personId" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "name" text NOT NULL,
    "slug" text NOT NULL,
    "shape" text NOT NULL,
    "color" text NOT NULL,
    "tone" text NOT NULL,
    "memory" text NOT NULL DEFAULT '',
    "notices" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "homeProjectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
    "updatedAt" timestamp with time zone NOT NULL DEFAULT now()
  );`,
  // How its ask_len requests ended (added after the first version of this table): additive.
  `ALTER TABLE "assistants" ADD COLUMN IF NOT EXISTS "notices" jsonb NOT NULL DEFAULT '[]'::jsonb;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "assistants_personId_slug_idx" ON "assistants" ("personId", "slug");`,
  `CREATE TABLE IF NOT EXISTS "assistantProjects" (
    "projectId" text PRIMARY KEY REFERENCES "projects"("id") ON DELETE CASCADE,
    "assistantId" text NOT NULL REFERENCES "assistants"("id") ON DELETE CASCADE,
    "connectedAt" timestamp with time zone NOT NULL DEFAULT now()
  );`,
  // Phase 2A — visitors (spec §4.4.5, §4.7, §6.5): on the page, what it knows, visits, the month's spend, the cap.
  `ALTER TABLE "assistantProjects" ADD COLUMN IF NOT EXISTS "onPage" boolean NOT NULL DEFAULT false;`,
  `ALTER TABLE "assistantProjects" ADD COLUMN IF NOT EXISTS "knowledge" text;`,
  `ALTER TABLE "assistantProjects" ADD COLUMN IF NOT EXISTS "knowledgeAt" timestamp with time zone;`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "assistantVisitorCap" integer;`,
  // Phase 2B — what the page's data shows anyone, saved at publish.
  `ALTER TABLE "assistantProjects" ADD COLUMN IF NOT EXISTS "publicData" jsonb;`,
  `CREATE TABLE IF NOT EXISTS "assistantVisits" (
    "id" text PRIMARY KEY,
    "assistantId" text NOT NULL REFERENCES "assistants"("id") ON DELETE CASCADE,
    "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "visitorId" text NOT NULL,
    "startedAt" timestamp with time zone NOT NULL,
    "lastAt" timestamp with time zone NOT NULL,
    "messageCount" integer NOT NULL DEFAULT 0,
    "centicredits" integer NOT NULL DEFAULT 0,
    "handedOff" boolean NOT NULL DEFAULT false,
    "transcript" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "lines" jsonb NOT NULL DEFAULT '[]'::jsonb
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "assistantVisits_who_idx" ON "assistantVisits" ("assistantId", "projectId", "visitorId");`,
  `CREATE INDEX IF NOT EXISTS "assistantVisits_assistant_last_idx" ON "assistantVisits" ("assistantId", "lastAt");`,
  `CREATE TABLE IF NOT EXISTS "assistantVisitorMonths" (
    "userId" text NOT NULL,
    "month" text NOT NULL,
    "centicredits" integer NOT NULL DEFAULT 0,
    "messages" integer NOT NULL DEFAULT 0,
    "asleepAlerts" jsonb NOT NULL DEFAULT '[]'::jsonb,
    PRIMARY KEY ("userId", "month")
  );`,
  // Phase 3 — what visitors ask for and she can't do, joined into cards for her person (spec §4.3).
  `CREATE TABLE IF NOT EXISTS "assistantRequestCards" (
    "id" text PRIMARY KEY,
    "assistantId" text NOT NULL REFERENCES "assistants"("id") ON DELETE CASCADE,
    "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "title" text NOT NULL,
    "locale" text NOT NULL,
    "status" text NOT NULL DEFAULT 'pending',
    "visitors" integer NOT NULL DEFAULT 0,
    "createdAt" timestamp with time zone NOT NULL,
    "lastAt" timestamp with time zone NOT NULL,
    "decidedAt" timestamp with time zone,
    "decidedBy" text,
    "acceptedRowId" text,
    "failure" text
  );`,
  `CREATE INDEX IF NOT EXISTS "assistantRequestCards_assistant_project_status_idx" ON "assistantRequestCards" ("assistantId", "projectId", "status");`,
  `CREATE TABLE IF NOT EXISTS "assistantRequests" (
    "id" text PRIMARY KEY,
    "assistantId" text NOT NULL REFERENCES "assistants"("id") ON DELETE CASCADE,
    "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "visitorId" text NOT NULL,
    "text" text NOT NULL,
    "locale" text NOT NULL,
    "at" timestamp with time zone NOT NULL,
    "cardId" text REFERENCES "assistantRequestCards"("id") ON DELETE SET NULL,
    "attempts" integer NOT NULL DEFAULT 0,
    "discardedAt" timestamp with time zone
  );`,
  `CREATE INDEX IF NOT EXISTS "assistantRequests_waiting_idx" ON "assistantRequests" ("assistantId", "projectId") WHERE "cardId" IS NULL AND "discardedAt" IS NULL;`,
  `CREATE INDEX IF NOT EXISTS "assistantRequests_card_idx" ON "assistantRequests" ("cardId");`,
  `CREATE INDEX IF NOT EXISTS "assistantRequests_assistant_at_idx" ON "assistantRequests" ("assistantId", "at");`,
];
