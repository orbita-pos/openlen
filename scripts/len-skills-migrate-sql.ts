// The SQL of `npm run len-skills:migrate`, apart so the PGlite test creates the very same table
// (lib/agent/skills/store.pglite.test.ts). Keep in step with lib/db/schema.ts (`lenSkills`).
export const CREATE_LEN_SKILLS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS "lenSkills" (
    "id" text PRIMARY KEY,
    "scope" text NOT NULL,
    "ownerId" text NOT NULL,
    "name" text NOT NULL,
    "text" text NOT NULL,
    "authorId" text,
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "updatedAt" timestamp NOT NULL DEFAULT now(),
    "deletedAt" timestamp
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "lenSkills_scope_owner_name_idx" ON "lenSkills" ("scope", "ownerId", "name");`,
];
