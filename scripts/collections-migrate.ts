// Create the Collections-module tables (idempotent) — collections +
// collection_items. Used instead of `db:push` because the full-schema push
// stops on unrelated drift; this applies ONLY the collections DDL. Keep in
// sync with lib/db/schema.ts.
//
// Run: npm run collections:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS "collections" (
      "id" text PRIMARY KEY,
      "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "name" text NOT NULL,
      "description" text,
      "preset" text NOT NULL DEFAULT 'products',
      "layout" text NOT NULL DEFAULT 'grid',
      "status" text NOT NULL DEFAULT 'active',
      "sortOrder" integer NOT NULL DEFAULT 0,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    );`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "collections_projectId_idx"
      ON "collections" ("projectId", "status");`,
  );

  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS "collection_items" (
      "id" text PRIMARY KEY,
      "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "collectionId" text NOT NULL REFERENCES "collections"("id") ON DELETE CASCADE,
      "title" text NOT NULL,
      "subtitle" text,
      "description" text,
      "imageUrl" text,
      "priceDisplay" text,
      "badge" text,
      "ctaLabel" text,
      "ctaUrl" text,
      "tags" text[] NOT NULL DEFAULT '{}'::text[],
      "attrs" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "status" text NOT NULL DEFAULT 'published',
      "sortOrder" integer NOT NULL DEFAULT 0,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    );`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "collection_items_collectionId_idx"
      ON "collection_items" ("collectionId", "sortOrder");`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "collection_items_projectId_idx"
      ON "collection_items" ("projectId", "status");`,
  );

  console.log("collections tables ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
