// TOOLS MADE BY LEN: installed tools and their releases (spec local 2026-11-04-herramientas-hechas-por-len).
// Idempotent (IF NOT EXISTS). Keep in step with lib/db/schema.ts.
//
// 🔴 REQUIRED in the same deploy as the code: without it «Instalar» fails to save and the tools list is empty.
// On the box it runs from scripts/build-migrations.mjs.
//
// Run: npm run tools:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";
import { CREATE_TOOLS } from "./tools-migrate-sql";

async function main() {
  for (const statement of CREATE_TOOLS) await db.execute(sql.raw(statement));
  console.log("[tools:migrate] listo");
  process.exit(0);
}

main().catch((err) => {
  console.error("[tools:migrate] falló", err);
  process.exit(1);
});
