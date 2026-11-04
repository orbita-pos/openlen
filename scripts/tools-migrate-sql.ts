// The SQL of `npm run tools:migrate`, apart so the PGlite test creates the very same tables
// (lib/tools/store.pglite.test.ts). Keep in step with lib/db/schema.ts (`toolReleases`, `toolInstallations`).
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
];
