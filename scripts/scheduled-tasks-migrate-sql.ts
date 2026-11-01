// The SQL of `npm run scheduled-tasks:migrate`, apart so the PGlite test creates the very same tables
// (lib/scheduled-tasks/store.pglite.test.ts). Keep in step with lib/db/schema.ts (`scheduledTasks`,
// `scheduledTaskRuns`).
export const CREATE_SCHEDULED_TASKS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS "scheduledTasks" (
    "id" text PRIMARY KEY,
    "projectId" text NOT NULL,
    "createdBy" text NOT NULL,
    "locale" text NOT NULL,
    "timeZone" text NOT NULL,
    "record" jsonb NOT NULL,
    "scheduledAt" timestamptz NOT NULL,
    "status" text NOT NULL DEFAULT 'active',
    "lastRunId" text,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "scheduledTasks_projectId_projects_id_fk"
      FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE,
    CONSTRAINT "scheduledTasks_createdBy_users_id_fk"
      FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE CASCADE
  );`,
  `CREATE INDEX IF NOT EXISTS "scheduledTasks_status_scheduledAt_idx" ON "scheduledTasks" ("status", "scheduledAt");`,
  `CREATE INDEX IF NOT EXISTS "scheduledTasks_projectId_idx" ON "scheduledTasks" ("projectId");`,
  `CREATE TABLE IF NOT EXISTS "scheduledTaskRuns" (
    "id" text PRIMARY KEY,
    "taskId" text NOT NULL,
    "projectId" text NOT NULL,
    "occurrenceAt" timestamptz NOT NULL,
    "claimedAt" timestamptz NOT NULL DEFAULT now(),
    "processStartedAt" timestamptz NOT NULL,
    "startedAt" timestamptz,
    "finishedAt" timestamptz,
    "outcome" text,
    "reason" text,
    "reply" text,
    "emailedAt" timestamptz,
    CONSTRAINT "scheduledTaskRuns_taskId_scheduledTasks_id_fk"
      FOREIGN KEY ("taskId") REFERENCES "scheduledTasks"("id") ON DELETE CASCADE
  );`,
  `CREATE INDEX IF NOT EXISTS "scheduledTaskRuns_unfinished_idx" ON "scheduledTaskRuns" ("finishedAt") WHERE "finishedAt" IS NULL;`,
  `CREATE INDEX IF NOT EXISTS "scheduledTaskRuns_claimedAt_idx" ON "scheduledTaskRuns" ("claimedAt");`,
  // Pausing a recurring task (spec local 2026-10-31-len-movil, §5.5).
  `ALTER TABLE "scheduledTasks" ADD COLUMN IF NOT EXISTS "pausedAt" timestamptz;`,
];
