// LAS VARIABLES DE ENTORNO DE LAS APPS (spec local
// docs/superpowers/specs/2026-10-10-variables-de-entorno-design.md): la tabla
// `projectEnvVars` y las huellas `projects.envHash` / `projects.publishedEnvHash`.
// Idempotente (IF NOT EXISTS). Mantener en sintonía con lib/db/schema.ts.
//
// 🔴 OBLIGATORIA en el mismo deploy que el código: `getProject` SELECCIONA todas
// las columnas de `projects`, así que sin las dos columnas no abre ningún proyecto.
//
// Run: npm run env-vars:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "projectEnvVars" (
      "projectId" text NOT NULL,
      "name" text NOT NULL,
      "target" text NOT NULL,
      "value" text NOT NULL,
      "updatedAt" timestamp NOT NULL DEFAULT now(),
      "updatedBy" text,
      CONSTRAINT "projectEnvVars_projectId_name_target_pk" PRIMARY KEY ("projectId", "name", "target"),
      CONSTRAINT "projectEnvVars_projectId_projects_id_fk"
        FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE,
      CONSTRAINT "projectEnvVars_target_check" CHECK ("target" IN ('draft', 'production'))
    );
  `);
  await db.execute(sql`ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "envHash" text;`);
  await db.execute(sql`ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "publishedEnvHash" text;`);
  console.log("[env-vars:migrate] projectEnvVars y las huellas de projects listas");
  process.exit(0);
}

main().catch((err) => {
  console.error("[env-vars:migrate] falló", err);
  process.exit(1);
});
