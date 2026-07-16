// Add users.lastSeenLeadsAt — the leads-inbox "seen" watermark (inbox badge).
// Idempotent, additive-only. Run: npm run inbox:migrate
// NOTE: no explicit process.exit(0) — libuv teardown on Windows breaks and
// deploy.ps1 reads it as failure; let the process drain naturally.

import { sql } from "drizzle-orm";
import { db } from "../lib/db";

async function main() {
  await db.execute(
    sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lastSeenLeadsAt" timestamp;`,
  );
  console.log("inbox migration ready: users.lastSeenLeadsAt");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
