// Crea la tabla `pageData` (idempotente). Se usa en vez de `db:push` porque el
// push del esquema completo se para en un prompt AJENO; esto aplica SÓLO este
// DDL. Mantener en sintonía con la definición en lib/db/schema.ts.
//
// Run: npm run page-data:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "pageData" (
      "id"        text PRIMARY KEY,
      "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "store"     text NOT NULL,
      "visitorId" text,
      "doc"       jsonb NOT NULL,
      "bytes"     integer NOT NULL,
      "createdAt" timestamp(3) NOT NULL DEFAULT now(),
      "updatedAt" timestamp(3) NOT NULL DEFAULT now(),
      "expiresAt" timestamp
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "pageData_project_store_idx"
      ON "pageData" ("projectId", "store");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "pageData_project_store_visitor_idx"
      ON "pageData" ("projectId", "store", "visitorId");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "pageData_expires_idx"
      ON "pageData" ("expiresAt");
  `);
  console.log("pageData: tabla e índices listos");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
