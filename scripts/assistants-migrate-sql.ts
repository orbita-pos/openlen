// The SQL of `npm run assistants:migrate`, apart so the PGlite tests create the very same tables
// (lib/assistants/*.pglite.test.ts). Keep in step with lib/db/schema.ts (`assistants`, `assistantProjects`).
// Spec local 2026-11-06-asistente-propio.
export const CREATE_ASSISTANTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS "assistants" (
    "id" text PRIMARY KEY,
    "personId" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "name" text NOT NULL,
    "slug" text NOT NULL,
    "shape" text NOT NULL,
    "color" text NOT NULL,
    "tone" text NOT NULL,
    "memory" text NOT NULL DEFAULT '',
    "homeProjectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
    "updatedAt" timestamp with time zone NOT NULL DEFAULT now()
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "assistants_personId_slug_idx" ON "assistants" ("personId", "slug");`,
  `CREATE TABLE IF NOT EXISTS "assistantProjects" (
    "projectId" text PRIMARY KEY REFERENCES "projects"("id") ON DELETE CASCADE,
    "assistantId" text NOT NULL REFERENCES "assistants"("id") ON DELETE CASCADE,
    "connectedAt" timestamp with time zone NOT NULL DEFAULT now()
  );`,
];
