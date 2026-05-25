// One-shot bootstrap: create the `customDomains` table + indexes if not
// already present. Idempotent — safe to re-run.

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

async function main(): Promise<void> {
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "customDomains" (
        "id" text PRIMARY KEY NOT NULL,
        "projectId" text NOT NULL,
        "domain" text NOT NULL UNIQUE,
        "verificationToken" text NOT NULL,
        "verifiedAt" timestamp,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "customDomains_projectId_fk"
          FOREIGN KEY ("projectId") REFERENCES "projects"("id")
          ON DELETE CASCADE
      )
    `),
  );
  // eslint-disable-next-line no-console
  console.log(`✓ customDomains table ensured`);

  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "customDomains_projectId_idx" ON "customDomains"("projectId")`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "customDomains_verifiedAt_idx" ON "customDomains"("verifiedAt")`,
    ),
  );
  // eslint-disable-next-line no-console
  console.log(`✓ indexes ensured`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
