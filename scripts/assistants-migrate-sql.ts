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
  // Phase 4E: her owner's read mark, as the page's inbox has (chatConversations.aReadAt/bReadAt).
  `ALTER TABLE "assistantVisits" ADD COLUMN IF NOT EXISTS "readAt" timestamp with time zone;`,
  `CREATE TABLE IF NOT EXISTS "assistantVisitorMonths" (
    "userId" text NOT NULL,
    "month" text NOT NULL,
    "centicredits" integer NOT NULL DEFAULT 0,
    "messages" integer NOT NULL DEFAULT 0,
    "asleepAlerts" jsonb NOT NULL DEFAULT '[]'::jsonb,
    PRIMARY KEY ("userId", "month")
  );`,
  // Phase 4 — one assistant serves several of her person's projects (spec §4.5).
  // «Her bubble is baked» apart from «what the project published». Until phase 4 the published text was saved only with
  // her on the page, so it meant the same: backfilled ONCE, when the column is added — never again, since from now on
  // turning her off and on keeps knowledgeAt and forgets bakedAt.
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'assistantProjects' AND column_name = 'bakedAt') THEN
      ALTER TABLE "assistantProjects" ADD COLUMN "bakedAt" timestamp with time zone;
      UPDATE "assistantProjects" SET "bakedAt" = "knowledgeAt" WHERE "onPage" AND "knowledgeAt" IS NOT NULL;
    END IF;
  END $$;`,
  `CREATE INDEX IF NOT EXISTS "assistantProjects_assistant_idx" ON "assistantProjects" ("assistantId");`,
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
    "failure" text,
    "notifiedAt" timestamp with time zone
  );`,
  `ALTER TABLE "assistantRequestCards" ADD COLUMN IF NOT EXISTS "notifiedAt" timestamp with time zone;`,
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
    "groupAfter" timestamp with time zone,
    "discardedAt" timestamp with time zone
  );`,
  `ALTER TABLE "assistantRequests" ADD COLUMN IF NOT EXISTS "groupAfter" timestamp with time zone;`,
  `CREATE INDEX IF NOT EXISTS "assistantRequests_waiting_idx" ON "assistantRequests" ("assistantId", "projectId") WHERE "cardId" IS NULL AND "discardedAt" IS NULL;`,
  `CREATE INDEX IF NOT EXISTS "assistantRequests_card_idx" ON "assistantRequests" ("cardId");`,
  `CREATE INDEX IF NOT EXISTS "assistantRequests_assistant_at_idx" ON "assistantRequests" ("assistantId", "at");`,
  // Phase 4D (spec §6.8) — her old addresses: renaming her moves her slug, and the old one redirects.
  `CREATE TABLE IF NOT EXISTS "assistantSlugAliases" (
    "personId" text NOT NULL,
    "slug" text NOT NULL,
    "assistantId" text NOT NULL REFERENCES "assistants"("id") ON DELETE CASCADE,
    "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY ("personId", "slug")
  );`,
  // Phase 4D (spec §6.9) — the morning summary: off unless turned on, its language, the last day it was claimed.
  `ALTER TABLE "assistants" ADD COLUMN IF NOT EXISTS "morningSummary" boolean NOT NULL DEFAULT false;`,
  // Phase 6 — her figure, whole (lib/figure/look.ts). NULL in a row from before: it wears the default look in its color.
  `ALTER TABLE "assistants" ADD COLUMN IF NOT EXISTS "look" jsonb;`,
  `ALTER TABLE "assistants" ADD COLUMN IF NOT EXISTS "summaryLocale" text;`,
  `ALTER TABLE "assistants" ADD COLUMN IF NOT EXISTS "lastSummaryOn" text;`,
];
