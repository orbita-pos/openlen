// The SQL of `npm run delivered-files:migrate`, apart so the PGlite test creates the very same table
// (lib/agent/skills/delivery-index.pglite.test.ts). Keep in step with lib/db/schema.ts (`deliveredFiles`).
export const CREATE_DELIVERED_FILES: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS "deliveredFiles" (
    "id" text PRIMARY KEY,
    "projectId" text NOT NULL,
    "turnId" text NOT NULL,
    "name" text NOT NULL,
    "url" text NOT NULL,
    "previewUrl" text,
    "size" integer NOT NULL,
    "contentType" text NOT NULL,
    "description" text,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "deliveredFiles_projectId_projects_id_fk"
      FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "deliveredFiles_url_idx" ON "deliveredFiles" ("url");`,
  `CREATE INDEX IF NOT EXISTS "deliveredFiles_projectId_createdAt_idx" ON "deliveredFiles" ("projectId", "createdAt" DESC);`,
];
