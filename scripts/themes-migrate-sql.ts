// The SQL of `npm run themes:migrate`, apart so the PGlite test creates the very same tables
// (lib/themes/store.pglite.test.ts). Keep in step with lib/db/schema.ts (`themeReleases`, `themeInstallations`,
// `workspaceThemeChoices`).
// Spec local 2026-11-27-temas-del-workspace, §12.1.
export const CREATE_THEMES: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS "themeReleases" (
    "sha" text PRIMARY KEY,
    "projectId" text NOT NULL,
    "themes" jsonb NOT NULL,
    "costs" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "glassAdjusted" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "measured" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "themeReleases_projectId_projects_id_fk"
      FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE
  );`,
  // A table made before the column existed gets it: what each scene measured, by its sha256 (a reinstall reuses it).
  `ALTER TABLE "themeReleases" ADD COLUMN IF NOT EXISTS "measured" jsonb NOT NULL DEFAULT '{}'::jsonb;`,
  `CREATE TABLE IF NOT EXISTS "themeInstallations" (
    "id" text PRIMARY KEY,
    "personId" text NOT NULL,
    "projectId" text NOT NULL,
    "releaseSha" text NOT NULL,
    "installedAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now(),
    "removedAt" timestamptz,
    CONSTRAINT "themeInstallations_projectId_projects_id_fk"
      FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE,
    CONSTRAINT "themeInstallations_personId_users_id_fk"
      FOREIGN KEY ("personId") REFERENCES "users"("id") ON DELETE CASCADE
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "themeInstallations_person_project_idx" ON "themeInstallations" ("personId", "projectId");`,
  `CREATE INDEX IF NOT EXISTS "themeInstallations_personId_idx" ON "themeInstallations" ("personId");`,
  // «scope» is the literal 'everywhere' or a project's id: no foreign key on it (it can't be one for 'everywhere').
  `CREATE TABLE IF NOT EXISTS "workspaceThemeChoices" (
    "personId" text NOT NULL,
    "scope" text NOT NULL,
    "themeRef" text NOT NULL,
    "updatedAt" timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY ("personId", "scope"),
    CONSTRAINT "workspaceThemeChoices_personId_users_id_fk"
      FOREIGN KEY ("personId") REFERENCES "users"("id") ON DELETE CASCADE
  );`,
];
