// LEN'S SUBAGENTS: their runs, the subagent's id on layer 0's rows and the custom types (spec local
// 2026-11-01-subagentes-de-len). Idempotent (IF NOT EXISTS). Keep in step with lib/db/schema.ts.
//
// 🔴 REQUIRED in the same deploy as the code: without it every `subagent` call fails to save its run.
// On the box it runs from scripts/build-migrations.mjs.
//
// Run: npm run subagents:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";
import { ALTER_AGENT_REQUEST_STEPS, ALTER_SUBAGENT_RUNS, CREATE_LEN_AGENTS, CREATE_SUBAGENTS } from "./subagents-migrate-sql";

async function main() {
  for (const statement of [...CREATE_SUBAGENTS, ...ALTER_SUBAGENT_RUNS, ...ALTER_AGENT_REQUEST_STEPS, ...CREATE_LEN_AGENTS]) await db.execute(sql.raw(statement));
  console.log("[subagents:migrate] listo");
  process.exit(0);
}

main().catch((err) => {
  console.error("[subagents:migrate] falló", err);
  process.exit(1);
});
