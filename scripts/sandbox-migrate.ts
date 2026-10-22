// scripts/sandbox-migrate.ts
// Creates the `projectSandboxes` table and its index (idempotent): the real terminal's E2B box per
// project (spec local 2026-10-21-real-terminal-e2b, lib/agent/sandbox/store.ts). Used instead of
// `db:push` so that ONLY this DDL runs. Keep in step with `projectSandboxes` in lib/db/schema.ts.
//
// No GRANT on purpose: `infra/db/roles.sql` gives `openlen_app` DML on every FUTURE table
// `openlen_migrate` creates (ALTER DEFAULT PRIVILEGES).
//
// Inert while the box is off (OPENLEN_SANDBOX=0 or no E2B_API_KEY): nothing reads it.
// 🔴 MANDATORY before turning it on: every turn that opens a box reads and writes it.
//
// Run: npm run sandbox:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "projectSandboxes" (
      "projectId"      text PRIMARY KEY REFERENCES "projects"("id") ON DELETE CASCADE,
      "sandboxId"      text,
      "template"       text,
      "state"          text NOT NULL DEFAULT 'none',
      "syncedManifest" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "heldBy"         text,
      "pausedAt"       timestamp with time zone,
      "updatedAt"      timestamp with time zone NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "projectSandboxes_pausedAt_idx"
      ON "projectSandboxes" ("pausedAt");
  `);
  console.log("projectSandboxes: table and index ready");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
