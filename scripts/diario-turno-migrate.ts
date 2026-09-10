// Añade projectChatMessages.toolResults — el diario del turno: qué devolvió
// cada herramienta, podado de bulto (lib/agent/diario-del-turno.ts).
//
// POR QUÉ. Medido contra producción el 2026-09-10: `cambiar_tema` falló en las
// dos únicas veces que un usuario pidió un color, y el motivo no está en ningún
// sitio — de esas llamadas sólo quedó la tarjeta, cuyo `summary` era literalmente
// «cambiar_tema». La transcripción guardaba la VISTA y no el resultado.
//
// Aditiva e idempotente. NO se rellena hacia atrás a propósito: de los turnos
// viejos no se guardó el resultado en ninguna parte, y fabricarlo desde el
// documento actual sería inventarse un motivo. NULL en las filas viejas se lee
// como lo que es —no hay diario— y se cura solo en el turno siguiente.
// Correr: npm run diario:migrate
// NOTA: sin process.exit(0) explícito — el cierre de libuv en Windows se rompe
// y deploy.ps1 lo lee como fallo; que el proceso drene solo.

import { sql } from "drizzle-orm";
import { db } from "../lib/db";

async function main() {
  await db.execute(
    sql`ALTER TABLE "projectChatMessages" ADD COLUMN IF NOT EXISTS "toolResults" jsonb;`,
  );
  console.log("diario del turno listo: projectChatMessages.toolResults");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
