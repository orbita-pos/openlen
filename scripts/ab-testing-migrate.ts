// EDGE A/B TESTING: abExperiments, abExperimentDaily and pageEvents.ab (Plan 3).
// Idempotent (IF NOT EXISTS). Keep in step with lib/db/schema.ts.
//
// 🔴 REQUIRED in the same deploy as the code: Drizzle selects all declared columns of
// pageEvents (including `ab`). On the box it runs from scripts/build-migrations.mjs.
//
// It runs on ONE dedicated connection, outside any transaction: the indexes on `pageEvents` and `formSubmissions` are
// built CONCURRENTLY (they take an insert per page view / per lead) under a `lock_timeout`, and CONCURRENTLY cannot run
// inside a transaction block nor on a pooled connection that may change between statements (review item 4).
//
// Run: npm run ab-testing:migrate

import { Client } from "pg";

import { runAbTestingMigration } from "./ab-testing-migrate-sql";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // Same TLS rule as lib/db/index.ts: only when the URL asks for it.
  const needsTls = /\bsslmode=(require|verify-ca|verify-full)\b/.test(url);
  const client = new Client({ connectionString: url, ssl: needsTls ? { rejectUnauthorized: false } : undefined });
  await client.connect();
  try {
    await runAbTestingMigration(client);
  } finally {
    await client.end();
  }
  console.log("[ab-testing:migrate] done");
  process.exit(0);
}

main().catch((err) => {
  console.error("[ab-testing:migrate] failed", err);
  process.exit(1);
});
