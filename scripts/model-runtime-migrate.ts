// Añade la columna de la cápsula de runtime del modelo a `projects`
// (idempotente). Se usa en vez de `db:push` porque el push del esquema completo
// se para en un prompt AJENO; esto aplica SÓLO este DDL. Mantener en sintonía
// con la definición de `projects` en lib/db/schema.ts.
//
// La columna nace NULL para TODAS las filas existentes, que es exactamente la
// semántica correcta: ningún proyecto de hoy —ni ninguno que venga de pegar
// HTML, de una plantilla, de la comunidad o de un duplicado— autoriza
// JavaScript del modelo. Sólo puede ponerla /api/generate, y sólo con el
// interruptor OPENLEN_MODEL_JS=1.
//
// Run: npm run model-runtime:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(
    sql`ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "generatedRuntime" jsonb;`,
  );

  const res = (await db.execute(
    sql`SELECT COUNT(*)::int AS "total",
               COUNT("generatedRuntime")::int AS "conCapsula"
        FROM "projects";`,
  )) as unknown;
  // `db.execute` devuelve un resultado de node-postgres (con `.rows`), no un
  // array. Se aceptan las dos formas para que este script no dependa de un
  // detalle del driver que puede cambiar bajo los pies.
  type Fila = { total: number; conCapsula: number };
  const filas: Fila[] = Array.isArray(res)
    ? (res as Fila[])
    : ((res as { rows?: Fila[] }).rows ?? []);
  const fila: Fila = filas[0] ?? { total: 0, conCapsula: 0 };
  const { total, conCapsula } = fila;

  console.log(`projects.generatedRuntime lista — ${total} proyectos, ${conCapsula} con cápsula.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
