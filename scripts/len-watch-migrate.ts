// LEN WATCH: the owner's switches and the incidents (spec local 2026-10-30-len-watch).
// Idempotent (IF NOT EXISTS). Keep in step with lib/db/schema.ts.
//
// 🔴 REQUIRED in the same deploy as the code: without it every report from a published page fails
// to open an incident. On the box it runs from scripts/build-migrations.mjs.
//
// Run: npm run len-watch:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";
import { CREATE_LEN_WATCH } from "./len-watch-migrate-sql";

async function main() {
  for (const statement of CREATE_LEN_WATCH) await db.execute(sql.raw(statement));
  console.log("[len-watch:migrate] done");
  process.exit(0);
}

main().catch((err) => {
  console.error("[len-watch:migrate] failed", err);
  process.exit(1);
});
