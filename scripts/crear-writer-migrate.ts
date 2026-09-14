// scripts/crear-writer-migrate.ts
// Añade a `users` la columna del escritor fijado para Crear (idempotente). Se
// usa en vez de `db:push` porque el push del esquema completo se para en un
// prompt AJENO; esto aplica SÓLO este DDL. Mantener en sintonía con `users` en
// lib/db/schema.ts.
//
// 🔴 Y ES OBLIGATORIA EN EL DESPLIEGUE, no opcional: Drizzle SELECCIONA las
// columnas declaradas, así que con la columna en `schema.ts` y sin este DDL en
// producción, cualquier lectura de `users` —empezando por entrar— responde
// `column "crearWriter" of relation "users" does not exist`. Ya pasó con
// `publishedHomeHash`, con `diario-turno` y con `agentEffort`. Por eso está
// listada en `targets` de `scripts/build-migrations.mjs`.
//
// Nace NULL para todas las filas, que es la semántica correcta: nadie ha
// elegido escritor, y sin elección manda la imagen adjunta, como siempre.
//
// Run: npm run crear-writer:migrate

import { sql } from "drizzle-orm";
import { db } from "../lib/db";

/** Las formas que devuelve `db.execute`: node-postgres trae `.rows`, otros
 *  drivers devuelven el array pelado. Se aceptan las dos para no depender de un
 *  detalle del driver. */
function filasDe(res: unknown): Record<string, unknown>[] {
  return Array.isArray(res)
    ? (res as Record<string, unknown>[])
    : ((res as { rows?: Record<string, unknown>[] }).rows ?? []);
}

async function main() {
  // 🔴 DICE A QUÉ BASE HABLA ANTES DE TOCARLA. La regla es de
  // [[database-url-local-es-produccion]], y su lección es concreta: una memoria
  // anterior identificó la base CONTANDO FILAS y se equivocó — una base de
  // desarrollo con datos copiados da los mismos números. El sistema operativo
  // del servidor no se falsifica por accidente: desarrollo es
  // `x86_64-WINDOWS`, producción es `x86_64-pc-linux-gnu`.
  const quien = filasDe(
    await db.execute(
      sql`SELECT version() AS "version", current_database() AS "base", current_user AS "rol";`,
    ),
  )[0] ?? {};
  console.log(
    `hablando con: ${quien.base ?? "?"} como ${quien.rol ?? "?"} — ${String(quien.version ?? "?").split(",")[0]}`,
  );

  await db.execute(
    sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "crearWriter" text;`,
  );

  const res = (await db.execute(
    sql`SELECT COUNT(*)::int AS "total",
               COUNT("crearWriter")::int AS "conEscritor"
        FROM "users";`,
  )) as unknown;
  const fila = filasDe(res)[0] ?? {};
  console.log(
    `users.crearWriter lista — ${fila.total ?? "?"} usuarios, ${fila.conEscritor ?? 0} con escritor fijado.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
