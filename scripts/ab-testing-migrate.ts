// EDGE A/B TESTING: abExperiments, abExperimentDaily and pageEvents.ab (Plan 3).
// Idempotent (IF NOT EXISTS). Keep in step with lib/db/schema.ts.
//
// 🔴 REQUIRED in the same deploy as the code: Drizzle selects all declared columns of
// pageEvents (including `ab`). On the box it runs from scripts/build-migrations.mjs.
//
// Run: npm run ab-testing:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";
import { CREATE_AB_TESTING } from "./ab-testing-migrate-sql";

async function main() {
  for (const statement of CREATE_AB_TESTING) await db.execute(sql.raw(statement));
  console.log("[ab-testing:migrate] done");
  process.exit(0);
}

main().catch((err) => {
  console.error("[ab-testing:migrate] failed", err);
  process.exit(1);
});
