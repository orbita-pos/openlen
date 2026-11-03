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

/** Phase 3: the subagent types of a project and of a person (`/.len/agents`, `~/.len/agents`), shaped like
 *  `lenSkills` (scripts/len-skills-migrate-sql.ts). Keep in step with lib/db/schema.ts (`lenAgents`). */
export const CREATE_LEN_AGENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS "lenAgents" (
    "id" text PRIMARY KEY,
    "scope" text NOT NULL,
    "ownerId" text NOT NULL,
    "name" text NOT NULL,
    "text" text NOT NULL,
    "authorId" text,
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "updatedAt" timestamp NOT NULL DEFAULT now(),
    "deletedAt" timestamp
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "lenAgents_scope_owner_name_idx" ON "lenAgents" ("scope", "ownerId", "name");`,
];

/** Layer 0's rows of a subagent's calls carry its id (null for Len's). Apart: the PGlite test has no steps table. */
export const ALTER_AGENT_REQUEST_STEPS: readonly string[] = [
  `ALTER TABLE "agentRequestSteps" ADD COLUMN IF NOT EXISTS "subagentId" text;`,
];

/** Phase 2: a child forked from Len's conversation (`subagent_fork`) resumes with Len's own system prompt, and one
 *  started in plan mode wakes read-only. */
export const ALTER_SUBAGENT_RUNS: readonly string[] = [
  `ALTER TABLE "subagentRuns" ADD COLUMN IF NOT EXISTS "forked" boolean NOT NULL DEFAULT false;`,
  `ALTER TABLE "subagentRuns" ADD COLUMN IF NOT EXISTS "planMode" boolean NOT NULL DEFAULT false;`,
  // Phase 4: an isolated child's copy, branch, base and how it came back.
  `ALTER TABLE "subagentRuns" ADD COLUMN IF NOT EXISTS "worktreeCopyId" text;`,
  `ALTER TABLE "subagentRuns" ADD COLUMN IF NOT EXISTS "worktreeBranch" text;`,
  `ALTER TABLE "subagentRuns" ADD COLUMN IF NOT EXISTS "worktreeBase" text;`,
  `ALTER TABLE "subagentRuns" ADD COLUMN IF NOT EXISTS "worktreeOutcome" jsonb;`,
];
