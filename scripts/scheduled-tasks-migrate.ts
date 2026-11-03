// LEN'S SCHEDULED TASKS: the tasks and their runs (spec local 2026-10-29-tareas-programadas).
// Idempotent (IF NOT EXISTS). Keep in step with lib/db/schema.ts.
//
// 🔴 REQUIRED in the same deploy as the code: without it every `schedule_create` fails to save and
// the scheduler finds no table. On the box it runs from scripts/build-migrations.mjs.
//
// Run: npm run scheduled-tasks:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";
import { ALTER_FORM_SUBMISSIONS, CREATE_EVENT_TASKS, CREATE_SCHEDULED_TASKS } from "./scheduled-tasks-migrate-sql";

async function main() {
  // Event tasks (spec local 2026-11-03-len-que-avisa) go after the scheduled ones: they share the cap.
  for (const statement of [...CREATE_SCHEDULED_TASKS, ...CREATE_EVENT_TASKS, ...ALTER_FORM_SUBMISSIONS]) await db.execute(sql.raw(statement));
  console.log("[scheduled-tasks:migrate] listo");
  process.exit(0);
}

main().catch((err) => {
  console.error("[scheduled-tasks:migrate] falló", err);
  process.exit(1);
});
