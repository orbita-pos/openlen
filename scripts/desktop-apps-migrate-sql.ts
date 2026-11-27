// The SQL of `npm run desktop-apps:migrate`, apart so the PGlite test creates the very same table
// (lib/desktop-apps/store.pglite.test.ts). Keep in step with lib/db/schema.ts (`desktopApps`).
// Spec local 2026-11-26-apps-en-el-escritorio, §4.2.
export const CREATE_DESKTOP_APPS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS "desktopApps" (
    "id" text PRIMARY KEY,
    "personId" text NOT NULL,
    "projectId" text NOT NULL,
    "releaseSha" text NOT NULL,
    "name" text NOT NULL,
    "iconPath" text,
    "toolInstallationId" text,
    "filesFingerprint" text NOT NULL,
    "hostLabel" text NOT NULL,
    "installedAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now(),
    "removedAt" timestamptz,
    CONSTRAINT "desktopApps_projectId_projects_id_fk"
      FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE,
    CONSTRAINT "desktopApps_personId_users_id_fk"
      FOREIGN KEY ("personId") REFERENCES "users"("id") ON DELETE CASCADE
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "desktopApps_person_project_idx" ON "desktopApps" ("personId", "projectId");`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "desktopApps_hostLabel_idx" ON "desktopApps" ("hostLabel");`,
  `CREATE INDEX IF NOT EXISTS "desktopApps_projectId_idx" ON "desktopApps" ("projectId");`,
];
