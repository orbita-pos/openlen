// scripts/agent-effort-migrate.ts
// Añade la columna de postura de esfuerzo a `users` (idempotente). Se usa en vez
// de `db:push` porque el push del esquema completo se para en un prompt AJENO;
// esto aplica SÓLO este DDL. Mantener en sintonía con `users` en
// lib/db/schema.ts.
//
// Nace NULL para todas las filas, que es la semántica correcta: nadie ha
// elegido postura, y sin elección el valor efectivo es `auto`.
//
// Run: npm run agent-effort:migrate

import { sql } from "drizzle-orm";
import { db } from "../lib/db";

async function main() {
  await db.execute(
    sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "agentEffort" text;`,
  );

  const res = (await db.execute(
    sql`SELECT COUNT(*)::int AS "total",
               COUNT("agentEffort")::int AS "conPostura"
        FROM "users";`,
  )) as unknown;
  const filas = Array.isArray(res)
    ? (res as Record<string, unknown>[])
    : ((res as { rows?: Record<string, unknown>[] }).rows ?? []);
  const fila = filas[0] ?? {};
  console.log(
    `users.agentEffort lista — ${fila.total ?? "?"} usuarios, ${fila.conPostura ?? 0} con postura elegida.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
