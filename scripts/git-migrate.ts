// GIT FOR LEN (spec local docs/superpowers/specs/2026-10-15-git-for-len-design.md): each project's
// repository. Idempotent (IF NOT EXISTS). Keep in step with lib/db/schema.ts
// (`projectGitObjects`, `projectGitRepos`).
//
// 🔴 MANDATORY in the same deploy as the code: the first git command or turn of a project
// creates its repository here (fail-soft: without the tables there is no git, the turn goes on).
//
// Run: npm run git:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "projectGitObjects" (
      "projectId" text NOT NULL,
      "oid" text NOT NULL,
      "type" text NOT NULL,
      "content" bytea NOT NULL,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      CONSTRAINT "projectGitObjects_projectId_oid_pk" PRIMARY KEY ("projectId", "oid"),
      CONSTRAINT "projectGitObjects_projectId_projects_id_fk"
        FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE
    );
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "projectGitRepos" (
      "projectId" text PRIMARY KEY,
      "head" text NOT NULL,
      "index" jsonb NOT NULL,
      "version" integer NOT NULL DEFAULT 0,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now(),
      CONSTRAINT "projectGitRepos_projectId_projects_id_fk"
        FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE
    );
  `);
  // Binaries (spec local 2026-10-28-ficheros-al-nivel-de-claude-code): a blob pointer instead of the bytes.
  await db.execute(sql`ALTER TABLE "projectGitObjects" ADD COLUMN IF NOT EXISTS "blobPointer" text`);
  // Branches (same spec, §8): every branch and which one is checked out.
  await db.execute(sql`ALTER TABLE "projectGitRepos" ADD COLUMN IF NOT EXISTS "refs" jsonb NOT NULL DEFAULT '{}'`);
  await db.execute(sql`ALTER TABLE "projectGitRepos" ADD COLUMN IF NOT EXISTS "currentBranch" text NOT NULL DEFAULT 'main'`);
  // Merge (same spec, §8): the merge in progress, git's MERGE_HEAD and MERGE_MSG.
  await db.execute(sql`ALTER TABLE "projectGitRepos" ADD COLUMN IF NOT EXISTS "mergeState" jsonb`);
  // Remotes (same spec, §8): the remotes and each branch's upstream.
  await db.execute(sql`ALTER TABLE "projectGitRepos" ADD COLUMN IF NOT EXISTS "remotes" jsonb NOT NULL DEFAULT '{}'`);
  await db.execute(sql`ALTER TABLE "projectGitRepos" ADD COLUMN IF NOT EXISTS "upstreams" jsonb NOT NULL DEFAULT '{}'`);
  // The GitHub App (same spec, §9): which installations each person connected. No token is ever stored.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "githubAppInstallations" (
      "userId" text NOT NULL,
      "installationId" bigint NOT NULL,
      "accountLogin" text NOT NULL,
      "accountType" text NOT NULL,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      CONSTRAINT "githubAppInstallations_userId_installationId_pk" PRIMARY KEY ("userId", "installationId"),
      CONSTRAINT "githubAppInstallations_userId_users_id_fk"
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
    );
  `);
  console.log("[git:migrate] projectGitObjects, projectGitRepos and githubAppInstallations ready");
  process.exit(0);
}

main().catch((err) => {
  console.error("[git:migrate] failed", err);
  process.exit(1);
});
