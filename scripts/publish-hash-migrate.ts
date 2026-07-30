// Add projects.publishedHomeHash — the fingerprint of `data.html` AS AUTHORED
// at publish time. Fixes the "unpublished changes" pill, which compared the
// SERVED bytes (publishedHtml, post ensurePageMeta + ensureSocialOgImage)
// against the raw source, so it was lit on every published page forever.
//
// Additive + idempotent. Deliberately NOT backfilled: what the source looked
// like at the last publish isn't recorded anywhere, and guessing it from the
// CURRENT data.html would assert "you have no unpublished changes" on a page
// that may well have some — a false negative, the one failure mode worse than
// the bug. NULL rows keep the legacy comparison (over-reports, never under-)
// and heal on their next publish. Run: npm run publish-hash:migrate
// NOTE: no explicit process.exit(0) — libuv teardown on Windows breaks and
// deploy.ps1 reads it as failure; let the process drain naturally.

import { sql } from "drizzle-orm";
import { db } from "../lib/db";

async function main() {
  await db.execute(
    sql`ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "publishedHomeHash" text;`,
  );
  console.log("publish hash migration ready: projects.publishedHomeHash");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
