// Adds `users.passwordChangedAt` (idempotent): when the password was last reset, so the sessions signed in
// before it are closed (lib/auth/session-cutoff.ts). NULL for everyone: no one's sessions close until they
// reset. Keep in step with `users` in lib/db/schema.ts.
//
// Run: npm run password-changed:migrate (the deploy runs it on the box: scripts/build-migrations.mjs)

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passwordChangedAt" timestamp;`);
  console.log("users.passwordChangedAt ready.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
