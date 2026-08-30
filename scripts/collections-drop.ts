// Retira las tablas del módulo Colecciones — collection_items + collections.
//
// El módulo se retiró el 2026-08-29 y las tablas salieron del esquema en
// 5b256407, pero las FILAS siguieron en Postgres a propósito: quitar del código
// es reversible, borrar datos no. Este script cierra esa asimetría cuando el
// dueño lo decide, y sólo entonces.
//
// POR QUÉ BORRARLAS Y NO DEJARLAS AHÍ: mientras la base tenga tablas que el
// esquema ya no declara, cualquier herramienta que reconcilie —`db:push` la
// primera— va a proponer el DROP por su cuenta, en medio de otra tarea. Es
// mejor deliberado, con respaldo, que como efecto secundario.
//
// NO usa `db:push`: su push de esquema completo se para con drift ajeno, y es
// justo la herramienta que dispararía el borrado accidental. Mismo patrón que
// el `collections-migrate.ts` que las creó — ese script se borra con este
// commit: su DDL vive dentro del respaldo, que es donde sirve para restaurar,
// y no como un camino de vuelta en el repo a un módulo retirado.
//
// Run: OPENLEN_CONFIRMO_BORRADO=1 npm run collections:drop

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

const TABLAS = ["collection_items", "collections"] as const;

async function existe(tabla: string): Promise<boolean> {
  const r = await db.execute(
    sql`SELECT to_regclass(${"public." + tabla}) IS NOT NULL AS hay`,
  );
  return (r as unknown as { rows: { hay: boolean }[] }).rows[0]?.hay === true;
}

async function contar(tabla: string): Promise<number> {
  const r = await db.execute(sql.raw(`SELECT count(*)::int AS n FROM "${tabla}"`));
  return (r as unknown as { rows: { n: number }[] }).rows[0]?.n ?? 0;
}

async function main() {
  // 1. Qué hay, ANTES de tocar nada. Un borrado que no dice lo que se lleva no
  //    se puede auditar después.
  const presentes: string[] = [];
  for (const t of TABLAS) {
    if (await existe(t)) {
      presentes.push(t);
      // eslint-disable-next-line no-console
      console.log(`  ${t}: ${await contar(t)} filas`);
    } else {
      // eslint-disable-next-line no-console
      console.log(`  ${t}: no existe (nada que hacer)`);
    }
  }

  if (presentes.length === 0) {
    // eslint-disable-next-line no-console
    console.log("Nada que borrar. Idempotente: ya estaba hecho.");
    return;
  }

  // 2. LA PUERTA. El script que las creaba no tenía ninguna, y hacía bien: crear
  //    una tabla vacía no se lleva nada por delante. Esto sí, y contra
  //    producción. Un `npm run` se teclea de memoria; una variable de entorno
  //    no se pone sin querer.
  if (process.env.OPENLEN_CONFIRMO_BORRADO !== "1") {
    // eslint-disable-next-line no-console
    console.error(
      "\nABORTADO — falta la confirmación explícita.\n" +
        "Haz el respaldo primero y vuelve con:\n" +
        "  OPENLEN_CONFIRMO_BORRADO=1 npm run collections:drop\n",
    );
    process.exitCode = 1;
    return;
  }

  // 3. En este orden y sin CASCADE. `collection_items.collectionId` referencia
  //    `collections.id`, así que los ítems van primero. CASCADE arrastraría en
  //    silencio lo que colgara de estas tablas sin que nadie lo viera; si algo
  //    cuelga, prefiero que esto FALLE y mirarlo.
  for (const t of TABLAS) {
    await db.execute(sql.raw(`DROP TABLE IF EXISTS "${t}"`));
    // eslint-disable-next-line no-console
    console.log(`  DROP ${t}`);
  }

  // 4. Comprobar, no suponer.
  for (const t of TABLAS) {
    if (await existe(t)) throw new Error(`${t} sigue existiendo tras el DROP`);
  }
  // eslint-disable-next-line no-console
  console.log("\nHecho. Las dos tablas ya no están.");
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
