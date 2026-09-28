// Añade projectChatMessages.transcript — la transcripción del turno: lo que vio
// el modelo, con los argumentos y los resultados enteros, y la huella de lo
// leído (lib/agent/transcripcion.ts).
//
// POR QUÉ. H4 de Len 2.x (plans/len-2/hipotesis/H4-alcance-prompt-e-historial.md):
// el historial lo mandaba el navegador y el servidor, por no fiarse, le quitaba
// los argumentos (el modelo veía «Edit {}») y resumía cada resultado a 400
// caracteres. Claude Code guarda su transcripción del lado de confianza y vacía
// los resultados viejos en vez de resumirlos; ésta es la columna para eso.
//
// Aditiva e idempotente. NO se rellena hacia atrás: de los turnos viejos no se
// guardó lo que vio el modelo, y el historial de esas filas cae a su texto.
// Correr: npm run transcripcion:migrate
// NOTA: sin process.exit(0) explícito — el cierre de libuv en Windows se rompe
// y deploy.ps1 lo lee como fallo; que el proceso drene solo.

import { sql } from "drizzle-orm";
import { db } from "../lib/db";

async function main() {
  await db.execute(
    sql`ALTER TABLE "projectChatMessages" ADD COLUMN IF NOT EXISTS "transcript" jsonb;`,
  );
  console.log("transcripción del turno lista: projectChatMessages.transcript");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
