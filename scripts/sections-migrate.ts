// Create the `sections` table directly (idempotent). Used instead of
// `db:push` because the full-schema push currently stops on an UNRELATED
// pending customDomains unique-constraint prompt; this applies ONLY the
// sections DDL. Keep in sync with the Drizzle definition in lib/db/schema.ts.
//
// Run: npm run sections:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "sections" (
      "id" text PRIMARY KEY NOT NULL,
      "type" text NOT NULL,
      "name" text NOT NULL,
      "variantLabel" text NOT NULL,
      "rootTag" text NOT NULL,
      "mode" text DEFAULT 'light' NOT NULL,
      "storageKey" text NOT NULL,
      "storageUrl" text NOT NULL,
      "contentHash" text NOT NULL,
      "size" integer NOT NULL,
      "designTokens" jsonb,
      "fonts" jsonb,
      "needsJs" boolean DEFAULT false NOT NULL,
      "hasPlaceholders" boolean DEFAULT false NOT NULL,
      "thumbnailUrl" text,
      "status" text DEFAULT 'published' NOT NULL,
      "createdAt" timestamp DEFAULT now() NOT NULL,
      "updatedAt" timestamp DEFAULT now() NOT NULL,
      "publishedAt" timestamp
    );
  `);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "sections_status_type_idx" ON "sections" ("status","type");`,
  );
  console.log("sections table ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
