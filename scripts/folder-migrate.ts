// LA CARPETA DEL PROYECTO (pieza 9 de plans/len-agente-2026/plan-2-5): la
// huella de los ficheros publicables en `projects` y la tabla de sus versiones.
// Idempotente (IF NOT EXISTS). Mantener en sintonía con lib/db/schema.ts
// (`projects.filesHash`, `projects.publishedFilesHash`, `projectFileVersions`).
//
// 🔴 OBLIGATORIA en el mismo deploy que el código: `getProject` SELECCIONA las
// dos columnas nuevas (el fallo de `publishedHomeHash`, ver deploy.ps1).
//
// Run: npm run folder:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(sql`ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "filesHash" text`);
  await db.execute(sql`ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "publishedFilesHash" text`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "projectFileVersions" (
      "id" text PRIMARY KEY,
      "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "path" text NOT NULL,
      "content" text,
      "label" text NOT NULL,
      "source" text NOT NULL,
      "createdAt" timestamp NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "projectFileVersions_project_path_idx"
      ON "projectFileVersions" ("projectId", "path", "createdAt");
  `);
  console.log("[folder:migrate] filesHash, publishedFilesHash y projectFileVersions listos");
  process.exit(0);
}

main().catch((err) => {
  console.error("[folder:migrate] falló", err);
  process.exit(1);
});
