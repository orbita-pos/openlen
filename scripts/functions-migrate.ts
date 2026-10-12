// Las Edge Functions (spec local 2026-10-11): sus seis tablas (los secretos,
// desde la fase 2; la marca de abuso, desde la 3), el paquete de producción y el ref propio
// del borrador en projectBackendEnvironments (relleno para los borradores que
// ya existen). Aditiva e idempotente. Mantener en sintonía con lib/db/schema.ts.
//
// 🔴 OBLIGATORIA antes que el código: lib/backend/environments.ts selecciona
// TODAS las columnas de projectBackendEnvironments.
//
// Run: npm run functions:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "functionDeployments" (
      "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "environment" text NOT NULL CHECK ("environment" IN ('draft', 'live')),
      "catalog" text NOT NULL,
      "hash" text NOT NULL,
      "functions" jsonb NOT NULL,
      "sourceMapsGz" text,
      "deployedAt" timestamp NOT NULL DEFAULT now(),
      PRIMARY KEY ("projectId", "environment")
    );
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "functionUsage" (
      "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "month" text NOT NULL,
      "calls" integer NOT NULL DEFAULT 0,
      "nanoUsd" bigint NOT NULL DEFAULT 0,
      PRIMARY KEY ("projectId", "month")
    );
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "functionPools" (
      "month" text NOT NULL,
      "pool" text NOT NULL CHECK ("pool" IN ('free', 'paid')),
      "reservedNanoUsd" bigint NOT NULL DEFAULT 0,
      "spentNanoUsd" bigint NOT NULL DEFAULT 0,
      PRIMARY KEY ("month", "pool")
    );
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "functionInvocations" (
      "id" text PRIMARY KEY,
      "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "environment" text NOT NULL CHECK ("environment" IN ('draft', 'live')),
      "name" text NOT NULL,
      "status" integer NOT NULL,
      "errorCode" text,
      "ms" integer NOT NULL,
      "logs" jsonb NOT NULL,
      "error" text,
      "startedAt" timestamp NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "functionInvocations_project_idx"
      ON "functionInvocations" ("projectId", "environment", "startedAt");
  `);
  await db.execute(sql`ALTER TABLE "projectBackendEnvironments" ADD COLUMN IF NOT EXISTS "publicRef" text;`);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "projectBackendEnvironments_publicRef_unique"
      ON "projectBackendEnvironments" ("publicRef");
  `);
  // Fila a fila: una subconsulta sin correlación se evaluaría UNA vez y daría
  // el mismo ref a todos (y el índice único lo rechazaría).
  await db.execute(sql`
    DO $$
    DECLARE r record;
    BEGIN
      FOR r IN SELECT "projectId" FROM "projectBackendEnvironments" WHERE "environment" = 'draft' AND "publicRef" IS NULL LOOP
        UPDATE "projectBackendEnvironments"
           SET "publicRef" = (SELECT string_agg(chr(97 + floor(random() * 26)::int), '') FROM generate_series(1, 20))
         WHERE "projectId" = r."projectId" AND "environment" = 'draft';
      END LOOP;
    END $$;
  `);
  // FASE 2: los secretos (cifrados) y el paquete de producción.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "functionSecrets" (
      "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "environment" text NOT NULL CHECK ("environment" IN ('draft', 'live')),
      "name" text NOT NULL,
      "valueEncrypted" text NOT NULL,
      "digest" text NOT NULL,
      "updatedAt" timestamp NOT NULL DEFAULT now(),
      "updatedBy" text,
      PRIMARY KEY ("projectId", "environment", "name")
    );
  `);
  await db.execute(sql`ALTER TABLE "functionDeployments" ADD COLUMN IF NOT EXISTS "bundleGz" text;`);
  // FASE 3: la marca que apaga las funciones de un proyecto (abuso).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "functionBlocks" (
      "projectId" text PRIMARY KEY REFERENCES "projects"("id") ON DELETE CASCADE,
      "reason" text NOT NULL,
      "blockedAt" timestamp NOT NULL DEFAULT now()
    );
  `);
  console.log("[functions:migrate] tablas listas y borradores con su ref propio");
  process.exit(0);
}

main().catch((err) => {
  console.error("[functions:migrate] falló", err);
  process.exit(1);
});
