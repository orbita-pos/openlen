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

/** «Len que avisa» (spec local 2026-11-03-len-que-avisa): event tasks, their records and their cards. Keep in
 *  step with lib/db/schema.ts (`eventTasks`, `eventTaskRecords`, `eventTaskCards`). */
export const CREATE_EVENT_TASKS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS "eventTasks" (
    "id" text PRIMARY KEY,
    "projectId" text NOT NULL,
    "createdBy" text NOT NULL,
    "locale" text NOT NULL,
    "timeZone" text NOT NULL,
    "title" text NOT NULL,
    "prompt" text NOT NULL,
    "source" text NOT NULL,
    "params" jsonb NOT NULL,
    "state" jsonb,
    "status" text NOT NULL DEFAULT 'active',
    "pausedAt" timestamptz,
    "nextCheckAt" timestamptz NOT NULL DEFAULT now(),
    "lastCheckedAt" timestamptz,
    "judgeDay" text,
    "judgesThatDay" integer NOT NULL DEFAULT 0,
    "transcript" jsonb,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "eventTasks_projectId_projects_id_fk"
      FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE,
    CONSTRAINT "eventTasks_createdBy_users_id_fk"
      FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE CASCADE
  );`,
  `CREATE INDEX IF NOT EXISTS "eventTasks_status_nextCheckAt_idx" ON "eventTasks" ("status", "nextCheckAt");`,
  `CREATE INDEX IF NOT EXISTS "eventTasks_projectId_idx" ON "eventTasks" ("projectId");`,
  `CREATE TABLE IF NOT EXISTS "eventTaskRecords" (
    "id" text PRIMARY KEY,
    "taskId" text NOT NULL,
    "projectId" text NOT NULL,
    "kind" text NOT NULL,
    "reason" text,
    "count" integer NOT NULL DEFAULT 1,
    "candidate" jsonb,
    "judge" text,
    "notified" boolean,
    "firstAt" timestamptz NOT NULL DEFAULT now(),
    "lastAt" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "eventTaskRecords_taskId_eventTasks_id_fk"
      FOREIGN KEY ("taskId") REFERENCES "eventTasks"("id") ON DELETE CASCADE,
    CONSTRAINT "eventTaskRecords_projectId_projects_id_fk"
      FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE
  );`,
  `CREATE INDEX IF NOT EXISTS "eventTaskRecords_taskId_lastAt_idx" ON "eventTaskRecords" ("taskId", "lastAt");`,
  `CREATE INDEX IF NOT EXISTS "eventTaskRecords_pending_idx" ON "eventTaskRecords" ("judge") WHERE "judge" = 'pending';`,
  `CREATE TABLE IF NOT EXISTS "eventTaskCards" (
    "id" text PRIMARY KEY,
    "taskId" text NOT NULL,
    "projectId" text NOT NULL,
    "recordId" text NOT NULL,
    "title" text NOT NULL,
    "summary" text NOT NULL,
    "proposedAction" text NOT NULL,
    "status" text NOT NULL DEFAULT 'pending',
    "decidedBy" text,
    "decidedAt" timestamptz,
    "acceptedRowId" text,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "eventTaskCards_taskId_eventTasks_id_fk"
      FOREIGN KEY ("taskId") REFERENCES "eventTasks"("id") ON DELETE CASCADE,
    CONSTRAINT "eventTaskCards_projectId_projects_id_fk"
      FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE
  );`,
  `CREATE INDEX IF NOT EXISTS "eventTaskCards_projectId_status_idx" ON "eventTaskCards" ("projectId", "status");`,
];

/** The form a submission came from (an event task watches one form). */
export const ALTER_FORM_SUBMISSIONS: readonly string[] = [`ALTER TABLE "formSubmissions" ADD COLUMN IF NOT EXISTS "formId" text;`];
