// LEN.md Y SU MEMORIA (plans/len-md): la tabla de las notas que Len escribe en
// /.len/memory/, y la limpieza de los marcadores de cuando la memoria sólo
// crecía. Idempotente (IF NOT EXISTS, y los UPDATE sólo tocan lo que aún lleva
// el marcador). Mantener en sintonía con lib/db/schema.ts (`lenMemoryNotes`).
//
// 🔴 OBLIGATORIA en el mismo deploy que el código: sin la tabla, Len no puede
// guardar notas (fail-soft: la lectura devuelve ninguna, el resto funciona).
//
// Run: npm run len-memory:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "lenMemoryNotes" (
      "id" text PRIMARY KEY,
      "projectId" text NOT NULL,
      "name" text NOT NULL,
      "type" text NOT NULL,
      "description" text NOT NULL,
      "body" text NOT NULL,
      "authorId" text,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now(),
      "deletedAt" timestamp,
      CONSTRAINT "lenMemoryNotes_projectId_projects_id_fk"
        FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE
    );
  `);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "lenMemoryNotes_project_name_idx" ON "lenMemoryNotes" ("projectId", "name");`);
  // Los marcadores de cuando la memoria sólo crecía ya no significan nada:
  // ahora es un fichero que se edita entero. Se van con el blanco de alrededor
  // (un párrafo en su lugar) y se recorta también el salto de línea: `btrim` a
  // secas sólo quita espacios, y el ensayo dejó un salto de línea delante de
  // cada LEN.md.
  const blanco = sql.raw(`' ' || chr(9) || chr(10) || chr(13)`);
  await db.execute(
    sql`UPDATE "users" SET "agentMemory" = NULLIF(btrim(regexp_replace("agentMemory", '[[:space:]]*— Lo que sé de ti —[[:space:]]*', chr(10) || chr(10), 'g'), ${blanco}), '') WHERE "agentMemory" LIKE '%— Lo que sé de ti —%';`,
  );
  await db.execute(
    sql`UPDATE "projects" SET "userBrief" = btrim(regexp_replace("userBrief", '[[:space:]]*— Preferencias guardadas por el agente —[[:space:]]*', chr(10) || chr(10), 'g'), ${blanco}) WHERE "userBrief" LIKE '%— Preferencias guardadas por el agente —%';`,
  );
  // Un /LEN.md que alguien escribiera ANTES en la carpeta se publicaba; ahora
  // es reservado (lib/agent/ficheros/folder.ts) y esa fila ya no se ve.
  const viejos = await db.execute(sql`SELECT "projectId" FROM "projectFiles" WHERE "path" = '/LEN.md';`);
  const filas = (viejos as unknown as { rows?: unknown[] }).rows ?? (viejos as unknown as unknown[]);
  console.log(`[len-memory:migrate] lenMemoryNotes lista; marcadores limpios. Proyectos con un /LEN.md en la carpeta (revisar a mano): ${JSON.stringify(filas)}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[len-memory:migrate] falló", err);
  process.exit(1);
});
