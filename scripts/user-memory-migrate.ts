// Añade la columna de memoria del Agente a `users` (idempotente). Se usa en vez
// de `db:push` porque el push del esquema completo se para en un prompt AJENO;
// esto aplica SÓLO este DDL. Mantener en sintonía con la definición de `users`
// en lib/db/schema.ts.
//
// La columna nace NULL para todas las filas, que es la semántica correcta:
// nadie tiene memoria de usuario hasta que el Agente guarde su primera
// preferencia con alcance "siempre". Las preferencias que hoy viven en
// `projects.userBrief` NO se migran — son del proyecto y ahí siguen valiendo.
//
// Run: npm run user-memory:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(
    sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "agentMemory" text;`,
  );

  const res = (await db.execute(
    sql`SELECT COUNT(*)::int AS "total",
               COUNT("agentMemory")::int AS "conMemoria"
        FROM "users";`,
  )) as unknown;
  // `db.execute` devuelve un resultado de node-postgres (con `.rows`), no un
  // array. Se aceptan las dos formas para no depender de un detalle del driver.
  const filas = Array.isArray(res)
    ? (res as Record<string, unknown>[])
    : ((res as { rows?: Record<string, unknown>[] }).rows ?? []);
  const fila = filas[0] ?? {};
  console.log(
    `users.agentMemory lista — ${fila.total ?? "?"} usuarios, ${fila.conMemoria ?? 0} con memoria.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
