// LOS HILOS EN EL CÓDIGO (@Len y @persona sobre una línea): los hilos, sus
// mensajes y las menciones. Idempotente (IF NOT EXISTS). Mantener en sintonía
// con lib/db/schema.ts (`codeThreads`, `codeThreadMessages`, `codeMentions`).
//
// 🔴 OBLIGATORIA en el mismo deploy que el código: la lente «Código» los pide
// al abrir un fichero (fail-soft: sin tablas no hay hilos, el resto funciona).
//
// Run: npm run hilos:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "codeThreads" (
      "id" text PRIMARY KEY,
      "projectId" text NOT NULL,
      "ruta" text NOT NULL,
      "linea" integer NOT NULL,
      "codigo" text NOT NULL,
      "estado" text NOT NULL DEFAULT 'abierto',
      "creadoPor" text NOT NULL,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now(),
      CONSTRAINT "codeThreads_projectId_projects_id_fk"
        FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "codeThreads_project_ruta_idx" ON "codeThreads" ("projectId", "ruta");`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "codeThreadMessages" (
      "id" text PRIMARY KEY,
      "threadId" text NOT NULL,
      "autorId" text,
      "texto" text NOT NULL,
      "filaId" text,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      CONSTRAINT "codeThreadMessages_threadId_codeThreads_id_fk"
        FOREIGN KEY ("threadId") REFERENCES "codeThreads"("id") ON DELETE CASCADE
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "codeThreadMessages_thread_idx" ON "codeThreadMessages" ("threadId", "createdAt");`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "codeMentions" (
      "id" text PRIMARY KEY,
      "projectId" text NOT NULL,
      "threadId" text NOT NULL,
      "messageId" text NOT NULL,
      "userId" text NOT NULL,
      "vistaAt" timestamp,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      CONSTRAINT "codeMentions_projectId_projects_id_fk"
        FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE,
      CONSTRAINT "codeMentions_threadId_codeThreads_id_fk"
        FOREIGN KEY ("threadId") REFERENCES "codeThreads"("id") ON DELETE CASCADE
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "codeMentions_user_idx" ON "codeMentions" ("userId", "projectId");`);
  // De dónde vino un turno pedido con `@Len` desde un hilo (la etiqueta del chat).
  await db.execute(sql`ALTER TABLE "projectChatMessages" ADD COLUMN IF NOT EXISTS "origen" jsonb;`);
  await db.execute(sql`ALTER TABLE "codeThreadMessages" ADD COLUMN IF NOT EXISTS "pedidoALen" jsonb;`);
  console.log("[hilos:migrate] codeThreads, codeThreadMessages (con pedidoALen), codeMentions y projectChatMessages.origen listas");
  process.exit(0);
}

main().catch((err) => {
  console.error("[hilos:migrate] falló", err);
  process.exit(1);
});
