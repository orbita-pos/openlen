// LO QUE CAMBIÓ CADA TURNO (F2 de las apps web, spec local
// docs/superpowers/specs/2026-10-07-apps-design.md): la tabla de la que sale
// «Deshacer» un turno entero. Idempotente (IF NOT EXISTS). Mantener en sintonía
// con lib/db/schema.ts (`projectTurnChanges`).
//
// 🔴 OBLIGATORIA en el mismo deploy que el código: el turno de Len escribe en
// ella al cerrar (fail-soft: sin tabla no hay Deshacer de servidor, pero el
// turno no se cae) y `POST /turnos/[turnId]/deshacer` la lee.
//
// Run: npm run turn-changes:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "projectTurnChanges" (
      "id" text PRIMARY KEY,
      "projectId" text NOT NULL,
      "turnId" text NOT NULL,
      "path" text NOT NULL,
      "contentBefore" text,
      "contentAfter" text,
      "undoable" boolean NOT NULL,
      "undoneAt" timestamp,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      -- Con el nombre que le da drizzle-kit: así \`db:push\` no ve diferencia.
      CONSTRAINT "projectTurnChanges_projectId_projects_id_fk"
        FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "projectTurnChanges_project_turn_idx"
      ON "projectTurnChanges" ("projectId", "turnId");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "projectTurnChanges_project_createdAt_idx"
      ON "projectTurnChanges" ("projectId", "createdAt");
  `);
  console.log("[turn-changes:migrate] projectTurnChanges lista");
  process.exit(0);
}

main().catch((err) => {
  console.error("[turn-changes:migrate] falló", err);
  process.exit(1);
});
