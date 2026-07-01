// Create the models table (idempotent) — used instead of `db:push` because the
// full-schema push stops on unrelated drift; this applies ONLY the models DDL.
// Keep in sync with lib/db/schema.ts (models table).
//
// Run: npm run models:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS "models" (
      "id" text PRIMARY KEY NOT NULL,
      "name" text NOT NULL,
      "family" text NOT NULL,
      "author" text DEFAULT 'OpenLen' NOT NULL,
      "pitch" text NOT NULL,
      "description" text NOT NULL,
      "storageKey" text NOT NULL,
      "storageUrl" text NOT NULL,
      "contentHash" text NOT NULL,
      "size" integer NOT NULL,
      "sceneSpec" jsonb,
      "tags" text[] DEFAULT '{}'::text[] NOT NULL,
      "license" text DEFAULT 'cc0' NOT NULL,
      "thumbnailUrl" text,
      "tileUrl" text,
      "previewImageUrl" text,
      "featured" boolean DEFAULT false NOT NULL,
      "status" text DEFAULT 'published' NOT NULL,
      "createdAt" timestamp DEFAULT now() NOT NULL,
      "updatedAt" timestamp DEFAULT now() NOT NULL,
      "publishedAt" timestamp
    );`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "models_status_family_idx" ON "models" ("status","family");`,
  );

  console.log("models table ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
