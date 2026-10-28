// Aditiva, idempotente; ejecutar después de movil-migrate, nunca db:push.
import { db } from "../lib/db";
import { migrarAvisos } from "../lib/movil/avisos-migracion";
async function main() {
  await migrarAvisos(db);
  console.log("tabla de avisos del teléfono lista.");
}
main().then(() => process.exit(0)).catch(() => { console.error("No se pudo migrar movilAvisos."); process.exit(1); });
