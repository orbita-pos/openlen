// Los dos entornos del backend (spec local 2026-10-09-borrador-y-produccion-de-datos):
// la tabla `projectBackendEnvironments` y, para cada proyecto que ya tenía base,
// su entorno de siempre (scope = ref): producción si está publicado, borrador si
// no. Idempotente. Mantener en sintonía con lib/db/schema.ts.
//
// 🔴 No correrlo en la máquina de desarrollo: `.env.local` apunta a producción.
// Corre en el deploy.
//
// Run: npm run backend-environments:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "projectBackendEnvironments" (
      "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "environment" text NOT NULL CHECK ("environment" IN ('draft', 'live')),
      "scope" text NOT NULL UNIQUE,
      "jwtSecretEncrypted" text NOT NULL,
      "readOnlyPasswordEncrypted" text,
      "provisionedAt" timestamp,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      PRIMARY KEY ("projectId", "environment")
    );
  `);
  const res = (await db.execute(sql`
    INSERT INTO "projectBackendEnvironments" ("projectId", "environment", "scope", "jwtSecretEncrypted", "provisionedAt")
    SELECT b."projectId",
           CASE WHEN p."status" = 'published' THEN 'live' ELSE 'draft' END,
           b."ref", b."jwtSecretEncrypted", b."provisionedAt"
      FROM "projectBackends" b
      JOIN "projects" p ON p."id" = b."projectId"
     WHERE b."provisionedAt" IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM "projectBackendEnvironments" e WHERE e."projectId" = b."projectId")
    ON CONFLICT DO NOTHING
    RETURNING "projectId", "environment";
  `)) as unknown;
  // `db.execute` devuelve un resultado de node-postgres (con `.rows`), no un
  // array. Se aceptan las dos formas, como en agent-effort-migrate.ts.
  const adopted = Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? []);
  console.log(`[backend-environments:migrate] tabla lista; ${adopted.length} bases de antes adoptadas`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[backend-environments:migrate] falló", err);
  process.exit(1);
});
