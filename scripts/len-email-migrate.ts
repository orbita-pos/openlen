// LEN POR CORREO: la tabla de los correos a Len (`lenEmailRequests`). Idempotente
// (IF NOT EXISTS). Mantener en sintonía con lib/db/schema.ts.
//
// 🔴 OBLIGATORIA en el mismo deploy que el código: sin ella, todo correo a Len
// falla al guardarse (la ruta contesta 500 y el Worker lo rebota).
//
// Run: npm run len-email:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "lenEmailRequests" (
      "id" text PRIMARY KEY,
      "dedupeKey" text NOT NULL,
      "projectId" text NOT NULL,
      "userId" text NOT NULL,
      "sender" text NOT NULL,
      "subject" text NOT NULL,
      "texto" text NOT NULL,
      "idioma" text NOT NULL,
      "inReplyTo" text,
      "respuesta" text,
      "contestadoAt" timestamp,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      CONSTRAINT "lenEmailRequests_projectId_projects_id_fk"
        FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE,
      CONSTRAINT "lenEmailRequests_userId_users_id_fk"
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
    );
  `);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "lenEmailRequests_dedupeKey_uq" ON "lenEmailRequests" ("dedupeKey");`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "lenEmailRequests_project_createdAt_idx" ON "lenEmailRequests" ("projectId", "createdAt");`);
  console.log("[len-email:migrate] lenEmailRequests lista");
  process.exit(0);
}

main().catch((err) => {
  console.error("[len-email:migrate] falló", err);
  process.exit(1);
});
