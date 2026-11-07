// THE PERSON'S OWN ASSISTANT (spec local 2026-11-06-asistente-propio): the tables `assistants` and
// `assistantProjects`. Additive and idempotent (IF NOT EXISTS).
//
// 🔴 MANDATORY in the same deploy as the code: without them, creating an assistant fails and its place answers 404.
//
// Run: npm run assistants:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";
import { CREATE_ASSISTANTS } from "./assistants-migrate-sql";

async function main() {
  for (const statement of CREATE_ASSISTANTS) await db.execute(sql.raw(statement));
  console.log("[assistants:migrate] assistants and assistantProjects ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[assistants:migrate] failed", err);
  process.exit(1);
});
