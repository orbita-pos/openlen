// THE INDEX OF WHAT LEN DELIVERED: the `deliveredFiles` table (spec local 2026-10-31-len-movil, §5.3),
// which the phone's «Entregado» lists. Idempotent (IF NOT EXISTS). Keep in step with lib/db/schema.ts.
//
// 🔴 REQUIRED in the same deploy as the code: without it every `present` logs a warning and the
// Delivered tab answers 500. On the box it runs from scripts/build-migrations.mjs.
//
// Run: npm run delivered-files:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";
import { CREATE_DELIVERED_FILES } from "./delivered-files-migrate-sql";

async function main() {
  for (const statement of CREATE_DELIVERED_FILES) await db.execute(sql.raw(statement));
  console.log("[delivered-files:migrate] done");
  process.exit(0);
}

main().catch((err) => {
  console.error("[delivered-files:migrate] failed", err);
  process.exit(1);
});
