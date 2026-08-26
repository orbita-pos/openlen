// Añade `projects.pageRuntimes` — el JavaScript del modelo de CADA subpágina,
// por slug (idempotente). Se usa en vez de `db:push` porque el push del esquema
// completo se para en un prompt AJENO; esto aplica SÓLO este DDL. Mantener en
// sintonía con la definición de `projects` en lib/db/schema.ts.
//
// POR QUÉ EXISTE. Hasta el 2026-08-25 sólo la Home podía llevar JavaScript, y
// no por una regla de producto sino por una de almacenamiento: la cápsula ata
// el código a UN documento exacto y sólo había UNA columna. Para el usuario el
// efecto era peor de lo que suena y está MEDIDO — no es que `/precios` no
// tuviera interactividad: es que **en cuanto añadía una segunda página, la Home
// también la perdía**, y un dominio propio la apagaba con una sola página.
//
// La columna nace NULL para todas las filas, que es la semántica correcta:
// ningún proyecto de hoy tiene JavaScript en sus subpáginas, porque hasta hoy
// no podía tenerlo. Nadie gana ni pierde nada al aplicar esto; sólo se abre la
// puerta para lo que venga.
//
// Run: npm run page-runtimes:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(
    sql`ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "pageRuntimes" jsonb;`,
  );

  const res = (await db.execute(
    sql`SELECT COUNT(*)::int AS "total",
               COUNT("generatedRuntime")::int AS "conHome",
               COUNT("pageRuntimes")::int AS "conPaginas"
        FROM "projects";`,
  )) as unknown;
  // `db.execute` devuelve un resultado de node-postgres (con `.rows`), no un
  // array. Se aceptan las dos formas para que este script no dependa de un
  // detalle del driver que puede cambiar bajo los pies.
  type Fila = { total: number; conHome: number; conPaginas: number };
  const filas: Fila[] = Array.isArray(res)
    ? (res as Fila[])
    : ((res as { rows?: Fila[] }).rows ?? []);
  const f: Fila = filas[0] ?? { total: 0, conHome: 0, conPaginas: 0 };

  console.log(
    `projects.pageRuntimes lista — ${f.total} proyectos · ${f.conHome} con JavaScript en la Home · ${f.conPaginas} con JavaScript en subpáginas.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
