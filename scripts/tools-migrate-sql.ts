// The SQL of `npm run tools:migrate`, apart so the PGlite test creates the very same tables
// (lib/tools/store.pglite.test.ts). Keep in step with lib/db/schema.ts (`toolReleases`, `toolInstallations`, `toolCards`,
// `users.toolSuggestions`).
// Spec local 2026-11-04-herramientas-hechas-por-len, §4.2 and §4.12.
export const CREATE_TOOLS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS "toolReleases" (
    "sha" text PRIMARY KEY,
    "projectId" text NOT NULL,
    "files" jsonb NOT NULL,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "toolReleases_projectId_projects_id_fk"
      FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE
  );`,
  `CREATE TABLE IF NOT EXISTS "toolInstallations" (
    "id" text PRIMARY KEY,
    "personId" text NOT NULL,
    "projectId" text NOT NULL,
    "releaseSha" text NOT NULL,
    "placement" text NOT NULL CHECK ("placement" IN ('rail', 'project')),
    "titles" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "descriptions" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "iconPath" text NOT NULL,
    "hostLabel" text NOT NULL,
    "enabled" boolean NOT NULL DEFAULT true,
    "installedAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now(),
    "removedAt" timestamptz,
    CONSTRAINT "toolInstallations_projectId_projects_id_fk"
      FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE,
    CONSTRAINT "toolInstallations_personId_users_id_fk"
      FOREIGN KEY ("personId") REFERENCES "users"("id") ON DELETE CASCADE
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "toolInstallations_person_project_idx" ON "toolInstallations" ("personId", "projectId");`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "toolInstallations_hostLabel_idx" ON "toolInstallations" ("hostLabel");`,
  `CREATE INDEX IF NOT EXISTS "toolInstallations_personId_idx" ON "toolInstallations" ("personId");`,
  // Phase 2 (§4.10): the «Crear» cards, and «Sugerencias de herramientas» — off until the person turns it on.
  `CREATE TABLE IF NOT EXISTS "toolCards" (
    "id" text PRIMARY KEY,
    "projectId" text NOT NULL,
    "chatRowId" text NOT NULL,
    "personId" text NOT NULL,
    "title" text NOT NULL,
    "brief" text NOT NULL,
    "initialContent" text,
    "placement" text NOT NULL CHECK ("placement" IN ('rail', 'project')),
    "customLocation" text,
    "phase" text NOT NULL DEFAULT 'proposed',
    "toolProjectId" text,
    "hostRowId" text,
    "creatorRunId" text,
    "cancelRequested" boolean NOT NULL DEFAULT false,
    "installationId" text,
    "error" text,
    "review" jsonb,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now(),
    "statusDeliveredAt" timestamptz,
    CONSTRAINT "toolCards_projectId_projects_id_fk"
      FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE,
    CONSTRAINT "toolCards_personId_users_id_fk"
      FOREIGN KEY ("personId") REFERENCES "users"("id") ON DELETE CASCADE,
    CONSTRAINT "toolCards_toolProjectId_projects_id_fk"
      FOREIGN KEY ("toolProjectId") REFERENCES "projects"("id") ON DELETE SET NULL
  );`,
  `CREATE INDEX IF NOT EXISTS "toolCards_project_person_phase_idx" ON "toolCards" ("projectId", "personId", "phase");`,
  `CREATE INDEX IF NOT EXISTS "toolCards_chatRowId_idx" ON "toolCards" ("chatRowId");`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "toolSuggestions" boolean NOT NULL DEFAULT false;`,
  // Phase 3 (§4.6): the installed version's job files, kept apart from what its host serves.
  `ALTER TABLE "toolReleases" ADD COLUMN IF NOT EXISTS "jobFiles" jsonb NOT NULL DEFAULT '{}'::jsonb;`,
  // Phase 3: a tool's jobs (DeepSeek's job registry, the person as the owner).
  `CREATE TABLE IF NOT EXISTS "toolJobs" (
    "id" text PRIMARY KEY,
    "personId" text NOT NULL,
    "toolProjectId" text NOT NULL,
    "installationId" text,
    "releaseSha" text,
    "name" text NOT NULL,
    "title" text NOT NULL,
    "status" text NOT NULL DEFAULT 'running' CHECK ("status" IN ('running', 'stopping', 'completed', 'killed', 'failed')),
    "progress" text,
    "detail" text,
    "input" jsonb,
    "uploads" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "result" jsonb,
    "delivered" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "startedAt" timestamptz NOT NULL DEFAULT now(),
    "finishedAt" timestamptz,
    "seconds" integer NOT NULL DEFAULT 0,
    "chargedCentis" integer NOT NULL DEFAULT 0,
    CONSTRAINT "toolJobs_personId_users_id_fk"
      FOREIGN KEY ("personId") REFERENCES "users"("id") ON DELETE CASCADE,
    CONSTRAINT "toolJobs_toolProjectId_projects_id_fk"
      FOREIGN KEY ("toolProjectId") REFERENCES "projects"("id") ON DELETE CASCADE
  );`,
  `CREATE INDEX IF NOT EXISTS "toolJobs_person_tool_started_idx" ON "toolJobs" ("personId", "toolProjectId", "startedAt");`,
  `CREATE INDEX IF NOT EXISTS "toolJobs_status_idx" ON "toolJobs" ("status");`,
  // Phase 3: what the person picked in OpenLen's own picker — the only files a job gets.
  `CREATE TABLE IF NOT EXISTS "toolUploads" (
    "id" text PRIMARY KEY,
    "personId" text NOT NULL,
    "toolProjectId" text NOT NULL,
    "name" text NOT NULL,
    "size" integer NOT NULL,
    "contentType" text NOT NULL,
    "pointer" text NOT NULL,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "toolUploads_personId_users_id_fk"
      FOREIGN KEY ("personId") REFERENCES "users"("id") ON DELETE CASCADE,
    CONSTRAINT "toolUploads_toolProjectId_projects_id_fk"
      FOREIGN KEY ("toolProjectId") REFERENCES "projects"("id") ON DELETE CASCADE
  );`,
  `CREATE INDEX IF NOT EXISTS "toolUploads_person_idx" ON "toolUploads" ("personId");`,
];
