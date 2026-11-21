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
  // What Len's propose_skills proposed (spec local 2026-11-19-agentes-para-todos, §6.6). Keep in step with
  // lib/db/schema.ts (`skillProposals`).
  `CREATE TABLE IF NOT EXISTS "skillProposals" (
    "id" text PRIMARY KEY,
    "personId" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "name" text NOT NULL,
    "kind" text NOT NULL,
    "target" text,
    "description" text NOT NULL,
    "skillMd" text NOT NULL,
    "baseText" text,
    "fingerprint" text NOT NULL,
    "createdAt" timestamp NOT NULL DEFAULT now()
  );`,
  `CREATE INDEX IF NOT EXISTS "skillProposals_person_idx" ON "skillProposals" ("personId");`,
];
