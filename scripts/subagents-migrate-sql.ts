// The SQL of `npm run subagents:migrate`, apart so the PGlite test creates the very same table
// (lib/agent/subagents/store.pglite.test.ts). Keep in step with lib/db/schema.ts (`subagentRuns`,
// `agentRequestSteps.subagentId`).
export const CREATE_SUBAGENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS "subagentRuns" (
    "id" text PRIMARY KEY,
    "projectId" text NOT NULL,
    "chatRowId" text NOT NULL,
    "turnId" text NOT NULL,
    "personId" text NOT NULL,
    "preset" text NOT NULL,
    "description" text NOT NULL,
    "prompt" text NOT NULL,
    "status" text NOT NULL DEFAULT 'running',
    "transcript" jsonb,
    "actions" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "finalText" text,
    "diagnostic" text,
    "usage" jsonb,
    "toolUses" integer NOT NULL DEFAULT 0,
    "durationMs" integer,
    "chargedCenticredits" integer NOT NULL DEFAULT 0,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "settledAt" timestamptz,
    "noticeDeliveredAt" timestamptz,
    CONSTRAINT "subagentRuns_projectId_projects_id_fk"
      FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE
  );`,
  `CREATE INDEX IF NOT EXISTS "subagentRuns_projectId_status_idx" ON "subagentRuns" ("projectId", "status");`,
  `CREATE INDEX IF NOT EXISTS "subagentRuns_chatRowId_idx" ON "subagentRuns" ("chatRowId");`,
];

/** Layer 0's rows of a subagent's calls carry its id (null for Len's). Apart: the PGlite test has no steps table. */
export const ALTER_AGENT_REQUEST_STEPS: readonly string[] = [
  `ALTER TABLE "agentRequestSteps" ADD COLUMN IF NOT EXISTS "subagentId" text;`,
];

/** Phase 2: a child forked from Len's conversation (`subagent_fork`) resumes with Len's own system prompt. */
export const ALTER_SUBAGENT_RUNS: readonly string[] = [
  `ALTER TABLE "subagentRuns" ADD COLUMN IF NOT EXISTS "forked" boolean NOT NULL DEFAULT false;`,
];
