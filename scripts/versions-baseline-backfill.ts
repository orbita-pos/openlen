// Marca como baseline la versión `initial` más reciente de cada
// (projectId, page). Idempotente — correr una vez tras la migración.
//
// Run: npm run versions:baseline:backfill

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  const res = await db.execute(sql`
    UPDATE "projectVersions" SET "isBaseline" = true
    WHERE "id" IN (
      SELECT DISTINCT ON ("projectId", "page") "id"
      FROM "projectVersions"
      WHERE "source" = 'initial'
      ORDER BY "projectId", "page", "createdAt" DESC
    );
  `);

  console.log("baseline backfill done:", res.rowCount ?? "?", "rows");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
