// ONE-TIME. Marks verified all members that existed BEFORE Phase 2a: only
// pre-existing PASSWORDLESS (magic-link) members are verified-by-construction;
// a row with a password never proved ownership and must re-prove.
// NOT in members:migrate (re-runnable) because re-running would wrongly re-mark
// future casual signups as verified. Run ONCE, just after applying the
// emailVerifiedAt column migration.
//
// Run: npm run members:backfill-verified

import { sql } from "drizzle-orm";
import { db } from "../lib/db";

async function main() {
  const res = await db.execute(
    sql`UPDATE "siteMembers"
        SET "emailVerifiedAt" = "createdAt"
        WHERE "emailVerifiedAt" IS NULL AND "passwordHash" IS NULL`,
  );
  // drizzle-orm/neon-http returns { rowCount } on execute
  console.log(`backfilled emailVerifiedAt for ${(res as { rowCount?: number }).rowCount ?? "?"} member(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
