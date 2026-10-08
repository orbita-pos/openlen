// EL CHAT DEL EQUIPO: el tipo de cada fila del chat, a quién menciona y las
// menciones sin ver. Idempotente (IF NOT EXISTS). Mantener en sintonía con
// lib/db/schema.ts (`projectChatMessages.tipo`, `.menciones`, `projectChatMentions`).
//
// 🔴 OBLIGATORIA en el mismo deploy que el código: el chat lee `tipo` en cada carga.
//
// Run: npm run chat-equipo:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(sql`ALTER TABLE "projectChatMessages" ADD COLUMN IF NOT EXISTS "tipo" text;`);
  await db.execute(sql`ALTER TABLE "projectChatMessages" ADD COLUMN IF NOT EXISTS "menciones" jsonb;`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "projectChatMentions" (
      "id" text PRIMARY KEY,
      "projectId" text NOT NULL,
      "mensajeId" text NOT NULL,
      "userId" text NOT NULL,
      "vistaAt" timestamp,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      CONSTRAINT "projectChatMentions_projectId_projects_id_fk"
        FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE,
      CONSTRAINT "projectChatMentions_mensajeId_projectChatMessages_id_fk"
        FOREIGN KEY ("mensajeId") REFERENCES "projectChatMessages"("id") ON DELETE CASCADE
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "projectChatMentions_user_idx" ON "projectChatMentions" ("userId", "projectId");`);
  console.log("[chat-equipo:migrate] projectChatMessages.tipo, .menciones y projectChatMentions listos");
  process.exit(0);
}

main().catch((err) => {
  console.error("[chat-equipo:migrate] falló", err);
  process.exit(1);
});
