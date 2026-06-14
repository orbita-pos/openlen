// Add the multi-page `page` column to `projectChatMessages` directly (idempotent).
// Used instead of `db:push` because the full-schema push stops on an UNRELATED
// pending prompt; this applies ONLY the chat DDL. Keep in sync with the Drizzle
// `projectChatMessages` definition in lib/db/schema.ts.
//
// Run: npm run chat:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(
    sql`ALTER TABLE "projectChatMessages" ADD COLUMN IF NOT EXISTS "page" text;`,
  );

  console.log("projectChatMessages page column ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
