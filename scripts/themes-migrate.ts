// WORKSPACE THEMES: installed themes, their releases and a person's choices (spec local 2026-11-27-temas-del-workspace, §12.1).
// Idempotent (IF NOT EXISTS). Keep in step with lib/db/schema.ts.
//
// 🔴 REQUIRED in the same deploy as the code: without it «Instalar» a theme fails to save and the workspace finds no choice.
// On the box it runs from scripts/build-migrations.mjs.
//
// Run: npm run themes:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";
import { CREATE_THEMES } from "./themes-migrate-sql";

async function main() {
  for (const statement of CREATE_THEMES) await db.execute(sql.raw(statement));
  console.log("[themes:migrate] listo");
  process.exit(0);
}

main().catch((err) => {
  console.error("[themes:migrate] falló", err);
  process.exit(1);
});
