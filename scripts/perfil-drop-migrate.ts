// Tira la tabla `businessProfiles` y la columna `projects.profileId` —
// el paso 5 y último de la retirada del perfil de negocio.
//
// 🔴 ESTA MIGRACIÓN NO SE ARMA EN EL MISMO DESPLIEGUE QUE EL CÓDIGO.
//
// `deploy.ps1` aplica las migraciones en el paso 6 y hace el cambio atómico del
// código en el 7. O sea que entre las dos cosas producción sigue sirviendo el
// código VIEJO — y el código viejo SELECCIONA `projects.profileId`. Soltar la
// columna en ese hueco convierte cada consulta de proyectos en un 500 hasta que
// arranca el servicio nuevo.
//
// Por eso van DOS despliegues, que es el patrón de siempre para un borrado:
//
//   1. Despliegue A — sube el código que deja de leer la columna. Esta
//      migración NO está en `targets` (scripts/build-migrations.mjs), así que
//      no corre.
//   2. Despliegue B — se añade "perfil-drop-migrate" a `targets` y entonces sí:
//      cuando corre, producción ya lleva código al que la columna le da igual.
//
// RESPALDO. Las 16 filas de producción están fuera del repo, en el disco de
// Jesús, verificadas fila por fila contra la base (id, nombre, dueño, default)
// antes de escribir esto. No hay vuelta atrás desde aquí: si se quiere volver,
// se re-crea con `businessProfiles-migrate` y se re-insertan del respaldo.
//
// Es idempotente entera (IF EXISTS), así que re-desplegar es un no-op.
//
// Run: npx tsx --env-file=.env.local scripts/perfil-drop-migrate.ts

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  // A QUÉ BASE SE HABLA, ANTES DE TOCARLA. Un borrado no avisa dos veces, y
  // `.env.local` apunta a la base de DESARROLLO mientras el despliegue corre
  // esto contra producción con otro rol. Que quede en el log cuál era.
  const quien = await db.execute(sql`
    select current_database() as base,
           current_user as rol,
           inet_server_addr()::text as host,
           version() as version
  `);
  const fila = (quien as unknown as { rows?: Array<Record<string, unknown>> }).rows?.[0] ?? {};
  console.log(
    `[perfil-drop] base=${String(fila.base)} rol=${String(fila.rol)} host=${String(fila.host)}`,
  );
  console.log(`[perfil-drop] ${String(fila.version).slice(0, 60)}`);

  const antes = await db.execute(sql`
    select
      (select count(*) from information_schema.tables
        where table_name = 'businessProfiles') as tabla,
      (select count(*) from information_schema.columns
        where table_name = 'projects' and column_name = 'profileId') as columna
  `);
  const c = (antes as unknown as { rows?: Array<Record<string, unknown>> }).rows?.[0] ?? {};
  console.log(`[perfil-drop] antes: tabla=${String(c.tabla)} columna=${String(c.columna)}`);

  // La FK primero: soltar la columna se la lleva por delante igual, pero
  // nombrarla deja el log legible si algo falla a medias.
  await db.execute(
    sql`ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_profileId_fk";`,
  );
  await db.execute(sql`ALTER TABLE "projects" DROP COLUMN IF EXISTS "profileId";`);
  await db.execute(sql`DROP INDEX IF EXISTS "businessProfiles_userId_default_uq";`);
  await db.execute(sql`DROP INDEX IF EXISTS "businessProfiles_userId_idx";`);
  await db.execute(sql`DROP TABLE IF EXISTS "businessProfiles";`);

  const despues = await db.execute(sql`
    select
      (select count(*) from information_schema.tables
        where table_name = 'businessProfiles') as tabla,
      (select count(*) from information_schema.columns
        where table_name = 'projects' and column_name = 'profileId') as columna
  `);
  const d = (despues as unknown as { rows?: Array<Record<string, unknown>> }).rows?.[0] ?? {};
  console.log(`[perfil-drop] después: tabla=${String(d.tabla)} columna=${String(d.columna)}`);
  if (Number(d.tabla) !== 0 || Number(d.columna) !== 0) {
    throw new Error("el borrado no dejó la base como se esperaba");
  }
  console.log("[perfil-drop] listo — businessProfiles y projects.profileId fuera.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
