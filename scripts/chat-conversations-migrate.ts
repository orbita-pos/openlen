// El chat nuevo (plans/new-chat/): charlas archivables, lo que cobró y tardó
// cada turno, y el 👍/👎 de cada turno.
//
//   · projectChatMessages.conversation — NULL = la charla en curso; un id = una
//     charla archivada con «Empezar de cero», que se puede volver a abrir.
//   · projectChatMessages.centicredits / durationMs — los escribe el servidor
//     al cerrar la fila; el cierre del turno los enseña también al recargar.
//   · chatTurnFeedback — un voto por turno y persona, con motivos y nota.
//
// Aditiva e idempotente. NO se rellena hacia atrás: las filas que ya existen
// son la charla en curso (NULL) y de lo que costaron no queda registro por fila.
// Correr: npm run chat-conversations:migrate
// NOTA: sin process.exit(0) explícito — el cierre de libuv en Windows se rompe
// y deploy.ps1 lo lee como fallo; que el proceso drene solo.

import { sql } from "drizzle-orm";
import { db } from "../lib/db";

async function main() {
  await db.execute(sql`ALTER TABLE "projectChatMessages" ADD COLUMN IF NOT EXISTS "conversation" text;`);
  await db.execute(sql`ALTER TABLE "projectChatMessages" ADD COLUMN IF NOT EXISTS "centicredits" integer;`);
  await db.execute(sql`ALTER TABLE "projectChatMessages" ADD COLUMN IF NOT EXISTS "durationMs" integer;`);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "projectChatMessages_projectId_conversation_idx" ON "projectChatMessages" ("projectId", "conversation");`,
  );
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "chatTurnFeedback" (
      "id" text PRIMARY KEY,
      "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "turnId" text NOT NULL,
      "userId" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "rating" text NOT NULL,
      "reasons" jsonb,
      "note" text,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    );
  `);
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "chatTurnFeedback_turnId_userId_uq" ON "chatTurnFeedback" ("turnId", "userId");`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "chatTurnFeedback_projectId_idx" ON "chatTurnFeedback" ("projectId");`,
  );
  console.log("chat nuevo listo: conversation, centicredits, durationMs y chatTurnFeedback");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
