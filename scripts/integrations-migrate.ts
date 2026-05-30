// Create the `userConnections` + `projectDeployments` tables directly
// (idempotent). Used instead of `db:push` because the full-schema push stops
// on an UNRELATED pending prompt; this applies ONLY the integration DDL. Keep
// in sync with the Drizzle definitions in lib/db/schema.ts.
//
// Run: npm run integrations:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "userConnections" (
      "id" text PRIMARY KEY NOT NULL,
      "userId" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "provider" text NOT NULL,
      "accessToken" text NOT NULL,
      "refreshToken" text,
      "accountLabel" text,
      "teamId" text,
      "scope" text,
      "createdAt" timestamp DEFAULT now() NOT NULL,
      "updatedAt" timestamp DEFAULT now() NOT NULL
    );
  `);
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "userConnections_userId_provider_idx" ON "userConnections" ("userId","provider");`,
  );

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "projectDeployments" (
      "id" text PRIMARY KEY NOT NULL,
      "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "provider" text NOT NULL,
      "remoteName" text NOT NULL,
      "liveUrl" text,
      "lastDeployedAt" timestamp,
      "lastDeploySha" text,
      "createdAt" timestamp DEFAULT now() NOT NULL,
      "updatedAt" timestamp DEFAULT now() NOT NULL
    );
  `);
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "projectDeployments_projectId_provider_idx" ON "projectDeployments" ("projectId","provider");`,
  );

  console.log("userConnections + projectDeployments tables ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
