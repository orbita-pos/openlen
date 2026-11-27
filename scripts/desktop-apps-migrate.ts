// APPS INSTALLED ON THE DESKTOP: the `desktopApps` table (spec local 2026-11-26-apps-en-el-escritorio, §4.2).
// Idempotent (IF NOT EXISTS). Keep in step with lib/db/schema.ts.
//
// 🔴 REQUIRED in the same deploy as the code: without it «Instalar en el escritorio» fails to save and the window
// finds no app. On the box it runs from scripts/build-migrations.mjs.
//
// Run: npm run desktop-apps:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";
import { CREATE_DESKTOP_APPS } from "./desktop-apps-migrate-sql";

async function main() {
  for (const statement of CREATE_DESKTOP_APPS) await db.execute(sql.raw(statement));
  console.log("[desktop-apps:migrate] listo");
  process.exit(0);
}

main().catch((err) => {
  console.error("[desktop-apps:migrate] falló", err);
  process.exit(1);
});
