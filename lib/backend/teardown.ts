// Borrar un proyecto se lleva la base de su página.
//
// La base vive en OTRO clúster (el de las páginas) y la fila de
// `projectBackends` que dice cuál es se va en cascada con la del proyecto. Por
// eso son dos pasos: el `ref` se lee ANTES de borrar, y la base se borra
// DESPUÉS, sólo si el proyecto se borró de verdad. Lo usan `deleteProject` y
// los proyectos de usar y tirar de Len-Bench.

import "server-only";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { backendConfigured } from "./pg";
import { dropProjectDatabase } from "./provision";
/* ── carril D ── */
import { purgeProjectStorage } from "./storage/purge";

/** El `ref` de la base del proyecto, o null si no tiene. */
export async function pageDatabaseRef(projectId: string): Promise<string | null> {
  const [row] = await db
    .select({ ref: schema.projectBackends.ref })
    .from(schema.projectBackends)
    .where(eq(schema.projectBackends.projectId, projectId))
    .limit(1);
  return row?.ref ?? null;
}

/** La base y su rol fuera del clúster. Nunca lanza: el proyecto ya no existe,
 *  así que el borrado se da por hecho igual, y el `ref` queda en el registro
 *  para borrar la base a mano (`infra/db/pages-orphans.sh`). */
export async function dropPageDatabase(ref: string): Promise<void> {
  if (!backendConfigured()) return;
  await dropProjectDatabase(ref).catch((err: unknown) => {
    console.error("[backend] no se pudo borrar la base de la página", ref, err);
  });
  /* ── carril D: storage ── Sus ficheros también, aunque la base no se haya
   * podido borrar: el proyecto ya no existe. Nunca lanza, y sin R2 no toca la red. */
  await purgeProjectStorage(ref);
  /* ── fin carril D ── */
}
