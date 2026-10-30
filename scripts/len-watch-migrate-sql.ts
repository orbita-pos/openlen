// The SQL of `npm run len-watch:migrate`, apart so the PGlite test creates the very same tables
// (lib/len-watch/store.pglite.test.ts). Keep in step with lib/db/schema.ts (`lenWatchSettings`,
// `lenWatchIncidents`, `projectPublishedSources`).
export const CREATE_LEN_WATCH: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS "lenWatchSettings" (
    "projectId" text PRIMARY KEY,
    "autoFix" boolean NOT NULL DEFAULT false,
    "autoPublish" boolean NOT NULL DEFAULT false,
    "muted" boolean NOT NULL DEFAULT false,
    "locale" text,
    "updatedAt" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "lenWatchSettings_projectId_projects_id_fk"
      FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE
  );`,
  `CREATE TABLE IF NOT EXISTS "lenWatchIncidents" (
    "id" text PRIMARY KEY,
    "projectId" text NOT NULL,
    "status" text NOT NULL DEFAULT 'open',
    "sample" jsonb NOT NULL,
    "reports" integer NOT NULL DEFAULT 1,
    "summary" text,
    "reason" text,
    "shipsUnpublished" boolean NOT NULL DEFAULT false,
    "turnRowId" text,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now(),
    "resolvedAt" timestamptz,
    "resolution" text,
    "fixStamp" text,
    CONSTRAINT "lenWatchIncidents_projectId_projects_id_fk"
      FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE
  );`,
  // A table created before the column existed gets it too (idempotent).
  `ALTER TABLE "lenWatchIncidents" ADD COLUMN IF NOT EXISTS "fixStamp" text;`,
  // The lock of «one active incident per project»: a second open loses the race and inserts nothing.
  `CREATE UNIQUE INDEX IF NOT EXISTS "lenWatchIncidents_active_idx" ON "lenWatchIncidents" ("projectId") WHERE "status" <> 'resolved';`,
  `CREATE INDEX IF NOT EXISTS "lenWatchIncidents_resolvedAt_idx" ON "lenWatchIncidents" ("resolvedAt") WHERE "resolvedAt" IS NOT NULL;`,
  // What the last publish published (§5.5): the worktree of a fix is cut from it.
  `CREATE TABLE IF NOT EXISTS "projectPublishedSources" (
    "projectId" text PRIMARY KEY,
    "commitOid" text NOT NULL,
    "settings" jsonb,
    "app" jsonb,
    "extraFiles" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "publishedAt" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "projectPublishedSources_projectId_projects_id_fk"
      FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE
  );`,
];
