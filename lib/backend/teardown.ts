// Borrar un proyecto se lleva la base de su página.
//
// La base vive en OTRO clúster (el de las páginas) y la fila de
// `projectBackends` que dice cuál es se va en cascada con la del proyecto. Por
// eso son dos pasos: las bases (una por entorno) se leen ANTES de borrar, y la base se borra
// DESPUÉS, sólo si el proyecto se borró de verdad. Lo usan `deleteProject` y
// los proyectos de usar y tirar de Len-Bench.

import "server-only";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { backendConfigured } from "./pg";
import { listEnvironments } from "./environments";
import { dropDeveloperRole, dropProjectDatabase } from "./provision";
/* ── carril D ── */
import { purgeProjectStorage } from "./storage/purge";

/** Las bases del proyecto (una por entorno), o null si no tiene backend. */
export async function pageDatabaseScopes(projectId: string): Promise<{ ref: string; scopes: string[] } | null> {
  const [row] = await db
    .select({ ref: schema.projectBackends.ref, provisionedAt: schema.projectBackends.provisionedAt })
    .from(schema.projectBackends)
    .where(eq(schema.projectBackends.projectId, projectId))
    .limit(1);
  if (!row) return null;
  const envs = await listEnvironments(projectId);
  const scopes = envs.length > 0 ? envs.map((e) => e.scope) : row.provisionedAt ? [row.ref] : [];
  return { ref: row.ref, scopes };
}

/** Las bases, el rol y los ficheros fuera. Nunca lanza: el proyecto ya no
 *  existe, así que el borrado se da por hecho igual, y lo que quede se borra a
 *  mano (`infra/db/pages-orphans.sh`). */
export async function dropPageDatabases(t: { ref: string; scopes: readonly string[] }): Promise<void> {
  if (!backendConfigured()) return;
  for (const scope of t.scopes) {
    await dropProjectDatabase(scope).catch((err: unknown) => {
      console.error("[backend] no se pudo borrar la base de la página", scope, err);
    });
    /* ── carril D: storage ── Sus ficheros también, aunque la base no se haya
     * podido borrar: el proyecto ya no existe. Nunca lanza, y sin R2 no toca la red. */
    await purgeProjectStorage(scope);
  }
  await dropDeveloperRole(t.ref).catch((err: unknown) => {
    console.error("[backend] no se pudo borrar el rol del proyecto", t.ref, err);
  });
}
