// Add formSubmissions.seenAt — «visto» por formulario (plans/len-resultados/).
// Idempotent, additive-only, SIN relleno: lo anterior a users.lastSeenLeadsAt
// ya cuenta como visto por la regla de lib/resultados/visto.ts.
// Run: npm run formularios-visto:migrate
// NOTE: no explicit process.exit(0) — libuv teardown on Windows breaks and
// deploy.ps1 reads it as failure; let the process drain naturally.

import { sql } from "drizzle-orm";
import { db } from "../lib/db";

async function main() {
  await db.execute(sql`ALTER TABLE "formSubmissions" ADD COLUMN IF NOT EXISTS "seenAt" timestamp;`);
  console.log("formularios-visto migration ready: formSubmissions.seenAt");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
