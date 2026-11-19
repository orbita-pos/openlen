// Idempotent SQL for `npm run ab-testing:migrate`, separated so PGlite tests execute
// the exact same DDL as production. Keep in step with lib/db/schema.ts
// (`abExperiments`, `abExperimentDaily`, `pageEvents.ab`, `formSubmissions.meta.ab`).
export const CREATE_AB_TESTING: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS "abExperiments" (
    "id" text PRIMARY KEY,
    "projectId" text NOT NULL,
    "assistantId" text,
    "name" text NOT NULL,
    "hypothesis" text,
    "targetPath" text NOT NULL DEFAULT '/',
    "includeLocales" boolean NOT NULL DEFAULT false,
    "primaryMetric" text NOT NULL DEFAULT 'conversion_any',
    "splitBps" integer NOT NULL DEFAULT 5000,
    "salt" text NOT NULL,
    "status" text NOT NULL DEFAULT 'draft',
    "decisionStatus" text NOT NULL DEFAULT 'none',
    "copyProjectId" text,
    "branch" text,
    "baseCommitOid" text,
    "variantBCommitOid" text,
    "bringState" text,
    "controlReleaseSha" text,
    "experimentReleaseSha" text,
    "promotedReleaseSha" text,
    "winnerVariant" text,
    "metricsSnapshot" jsonb,
    "startedAt" timestamptz,
    "minEndAt" timestamptz,
    "snoozeUntil" timestamptz,
    "endedAt" timestamptz,
    "evaluatedAt" timestamptz,
    "notifiedAt" timestamptz,
    "decidedAt" timestamptz,
    "decidedBy" text,
    "createdBy" text NOT NULL,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "abExperiments_projectId_projects_id_fk"
      FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE,
    CONSTRAINT "abExperiments_assistantId_assistants_id_fk"
      FOREIGN KEY ("assistantId") REFERENCES "assistants"("id") ON DELETE SET NULL
  );`,
  // At most one live/draft experiment per (project, targetPath).
  `CREATE UNIQUE INDEX IF NOT EXISTS "abExperiments_active_target_idx"
    ON "abExperiments" ("projectId", "targetPath")
    WHERE "status" IN ('draft', 'running', 'winner_ready', 'inconclusive');`,
  `CREATE INDEX IF NOT EXISTS "abExperiments_running_idx"
    ON "abExperiments" ("status", "evaluatedAt")
    WHERE "status" = 'running';`,
  `CREATE INDEX IF NOT EXISTS "abExperiments_pending_decision_idx"
    ON "abExperiments" ("assistantId", "decisionStatus")
    WHERE "decisionStatus" = 'pending';`,
  `CREATE TABLE IF NOT EXISTS "abExperimentDaily" (
    "experimentId" text NOT NULL,
    "day" date NOT NULL,
    "variant" text NOT NULL,
    "views" integer NOT NULL DEFAULT 0,
    "clicks" integer NOT NULL DEFAULT 0,
    "conversions" integer NOT NULL DEFAULT 0,
    PRIMARY KEY ("experimentId", "day", "variant"),
    CONSTRAINT "abExperimentDaily_experimentId_abExperiments_id_fk"
      FOREIGN KEY ("experimentId") REFERENCES "abExperiments"("id") ON DELETE CASCADE
  );`,
  // Additive attribution column on pageEvents + partial index (zero overhead when no A/B runs).
  `ALTER TABLE "pageEvents" ADD COLUMN IF NOT EXISTS "ab" text;`,
  `CREATE INDEX IF NOT EXISTS "pageEvents_projectId_ab_ts_idx"
    ON "pageEvents" ("projectId", "ab", "ts")
    WHERE "ab" IS NOT NULL;`,
  `CREATE INDEX IF NOT EXISTS "formSubmissions_projectId_ab_idx"
    ON "formSubmissions" ("projectId", ("meta" ->> 'ab'))
    WHERE ("meta" ->> 'ab') IS NOT NULL;`,
];
