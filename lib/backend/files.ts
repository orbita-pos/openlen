// LA CARPETA DEL PROYECTO (`projectFiles`, pieza 9 de Len 2.5): los ficheros que
// no son páginas — `/supabase/` (migraciones), `/tests/` y los de la web (`js/`,
// `css/`, `data/`, `sw.js`…). Qué ruta vale lo decide
// lib/agent/ficheros/folder.ts; esto sólo los guarda.
//
// Cada escritura y cada borrado deja al día `projects.filesHash`, la huella de
// lo publicable: así «cambios sin publicar» se entera de un `js/app.js` nuevo.

import "server-only";
import { and, asc, eq, like } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { folderFingerprint } from "@/lib/projects/files-hash";
import { isPublishableFolderPath } from "@/lib/agent/ficheros/folder";

export async function listProjectFiles(projectId: string, prefix = "/"): Promise<Record<string, string>> {
  const rows = await db
    .select({ path: schema.projectFiles.path, content: schema.projectFiles.content })
    .from(schema.projectFiles)
    .where(and(eq(schema.projectFiles.projectId, projectId), like(schema.projectFiles.path, `${prefix}%`)))
    .orderBy(asc(schema.projectFiles.path));
  return Object.fromEntries(rows.map((r) => [r.path, r.content]));
}

async function refreshFilesHash(projectId: string): Promise<void> {
  const files = await listProjectFiles(projectId);
  await db.update(schema.projects).set({ filesHash: folderFingerprint(files) }).where(eq(schema.projects.id, projectId));
}

export async function saveProjectFile(projectId: string, path: string, content: string): Promise<void> {
  await db
    .insert(schema.projectFiles)
    .values({ projectId, path, content })
    .onConflictDoUpdate({
      target: [schema.projectFiles.projectId, schema.projectFiles.path],
      set: { content, updatedAt: new Date() },
    });
  await refreshFilesHash(projectId);
}

/** Borra un fichero. `false` si no existía. */
export async function deleteProjectFile(projectId: string, path: string): Promise<boolean> {
  const gone = await db
    .delete(schema.projectFiles)
    .where(and(eq(schema.projectFiles.projectId, projectId), eq(schema.projectFiles.path, path)))
    .returning({ path: schema.projectFiles.path });
  if (gone.length > 0) await refreshFilesHash(projectId);
  return gone.length > 0;
}

/** Copia la carpeta —lo que `keep` deja— a otro proyecto: duplicar y remezclar.
 *  Devuelve cuántos copió. */
export async function copyProjectFiles(
  fromProjectId: string,
  toProjectId: string,
  keep: (path: string) => boolean,
): Promise<number> {
  const files = Object.entries(await listProjectFiles(fromProjectId)).filter(([p]) => keep(p));
  if (files.length === 0) return 0;
  await db.insert(schema.projectFiles).values(files.map(([path, content]) => ({ projectId: toProjectId, path, content })));
  await refreshFilesHash(toProjectId);
  return files.length;
}

/** REMEZCLAR se lleva sólo lo que la publicada ya enseña: las pruebas
 *  (`tests/`) y las migraciones (`supabase/`) del autor no son públicas. */
export function copyFolderForRemix(fromProjectId: string, toProjectId: string): Promise<number> {
  return copyProjectFiles(fromProjectId, toProjectId, isPublishableFolderPath);
}

/** DUPLICAR es tu propia carpeta: entera. */
export function copyFolderForDuplicate(fromProjectId: string, toProjectId: string): Promise<number> {
  return copyProjectFiles(fromProjectId, toProjectId, () => true);
}
