// Add columns to `projectChatMessages` directly (idempotent, additive-only).
// Used instead of `db:push` because the full-schema push stops on an UNRELATED
// pending prompt; this applies ONLY the chat DDL. Keep in sync with the Drizzle
// `projectChatMessages` definition in lib/db/schema.ts.
//
// F2-T11: `actions` + `noDocChange` persist agent-mode tool cards + the
// answer-only flag so a reload rehydrates them instead of losing them.
//
// Run: npm run chat:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(
    sql`ALTER TABLE "projectChatMessages" ADD COLUMN IF NOT EXISTS "page" text;`,
  );
  await db.execute(
    sql`ALTER TABLE "projectChatMessages" ADD COLUMN IF NOT EXISTS "actions" jsonb;`,
  );
  await db.execute(
    sql`ALTER TABLE "projectChatMessages" ADD COLUMN IF NOT EXISTS "noDocChange" boolean;`,
  );

  console.log("projectChatMessages columns ready (page, actions, noDocChange).");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
