// scripts/credit-ledger-migrate.ts
// Creates the `creditLedger` table and its indexes (idempotent): the spend
// ledger of lib/credit-ledger.ts (spec local 2026-10-16-credit-ledger). Used
// instead of `db:push` so that ONLY this DDL runs. Keep in step with
// `creditLedger` in lib/db/schema.ts.
//
// No GRANT on purpose: `infra/db/roles.sql` gives `openlen_app` DML on every
// FUTURE table `openlen_migrate` creates (ALTER DEFAULT PRIVILEGES).
//
// 🔴 It must run BEFORE the code that writes the ledger (deploy.ps1 runs the
// list in scripts/build-migrations.mjs first). If it hasn't, charging still
// works: lib/credit-ledger.ts falls back to the plain debit and logs [ledger].
//
// Run: npm run credit-ledger:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "creditLedger" (
      "id"               text PRIMARY KEY,
      "userId"           text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "plan"             text NOT NULL,
      "actorId"          text,
      "projectId"        text,
      "surface"          text NOT NULL,
      "refId"            text,
      "centicredits"     integer NOT NULL,
      "listCenticredits" integer,
      "costMicroUsd"     bigint,
      "provider"         text,
      "model"            text,
      "inputTokens"      integer,
      "cachedTokens"     integer,
      "outputTokens"     integer,
      "reasoningTokens"  integer,
      "balanceAfter"     integer,
      "outcome"          text,
      "createdAt"        timestamp NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "creditLedger_userId_createdAt_idx"
      ON "creditLedger" ("userId", "createdAt");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "creditLedger_createdAt_idx"
      ON "creditLedger" ("createdAt");
  `);
  console.log("creditLedger: table and indexes ready");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
