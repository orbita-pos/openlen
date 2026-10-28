// LA CARPETA DEL PROYECTO (`projectFiles`, pieza 9 de Len 2.5): los ficheros que
// no son páginas — `/supabase/` (migraciones), `/tests/` y los de la web (`js/`,
// `css/`, `data/`, `sw.js`…). Qué ruta vale lo decide
// lib/agent/ficheros/folder.ts; esto sólo los guarda.
//
// Cada escritura y cada borrado deja al día `projects.filesHash`, la huella de
// lo publicable: así «cambios sin publicar» se entera de un `js/app.js` nuevo.

import "server-only";
import { and, asc, desc, eq, like, or } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { folderFingerprint } from "@/lib/projects/files-hash";
import { isRemixedFolderPath } from "@/lib/agent/ficheros/folder";

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

/** LAS EDGE FUNCTIONS (spec local 2026-10-11): un cambio en
 *  /supabase/functions/** o en config.toml redespliega el borrador, como
 *  `supabase functions serve` al guardar. Import perezoso: lib/functions/deploy
 *  importa el registro, que importa este fichero. */
function despuesDeCambiar(projectId: string, paths: readonly string[]): void {
  if (!paths.some((p) => p.startsWith("/supabase/functions/") || p === "/supabase/config.toml")) return;
  void import("@/lib/functions/deploy").then((m) => m.scheduleDraftDeployIfEnabled(projectId)).catch(() => undefined);
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
  despuesDeCambiar(projectId, [path]);
}

/** A folder file's bytes (spec local 2026-10-28-ficheros-al-nivel-de-claude-code): a text's in UTF-8, a
 *  binary's from storage by its pointer. `null` if there is no such file. */
export async function readProjectFileBytes(projectId: string, path: string): Promise<Uint8Array | null> {
  const [row] = await db
    .select({ content: schema.projectFiles.content })
    .from(schema.projectFiles)
    .where(and(eq(schema.projectFiles.projectId, projectId), eq(schema.projectFiles.path, path)))
    .limit(1);
  if (!row) return null;
  const { getBlob, isBlobPointer } = await import("@/lib/files/blob");
  return isBlobPointer(row.content) ? getBlob(row.content) : new TextEncoder().encode(row.content);
}

/** The folder's images and videos, newest first (spec local 2026-10-28): what the image modal lists among
 *  «your uploads», by the root-relative path the page references (it works on every page and domain). */
export async function listFolderMedia(projectId: string): Promise<
  { filename: string; contentType: string; size: number; url: string; uploadedAt: number }[]
> {
  const rows = await db
    .select({ path: schema.projectFiles.path, content: schema.projectFiles.content, updatedAt: schema.projectFiles.updatedAt })
    .from(schema.projectFiles)
    .where(and(eq(schema.projectFiles.projectId, projectId), or(like(schema.projectFiles.path, "/img/%"), like(schema.projectFiles.path, "/video/%"))))
    .orderBy(desc(schema.projectFiles.updatedAt));
  const { contentTypeFor } = await import("@/lib/agent/ficheros/folder");
  const { sizeOf } = await import("@/lib/files/blob-pointer");
  return rows
    .map((r) => ({ filename: r.path.slice(r.path.lastIndexOf("/") + 1), contentType: contentTypeFor(r.path).split(";")[0]!, size: sizeOf(r.content), url: r.path, uploadedAt: r.updatedAt.getTime() }))
    .filter((m) => m.contentType.startsWith("image/") || m.contentType.startsWith("video/"));
}

/** Borra un fichero. `false` si no existía. */
export async function deleteProjectFile(projectId: string, path: string): Promise<boolean> {
  const gone = await db
    .delete(schema.projectFiles)
    .where(and(eq(schema.projectFiles.projectId, projectId), eq(schema.projectFiles.path, path)))
    .returning({ path: schema.projectFiles.path });
  if (gone.length > 0) {
    await refreshFilesHash(projectId);
    despuesDeCambiar(projectId, [path]);
  }
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
  despuesDeCambiar(toProjectId, files.map(([p]) => p));
  return files.length;
}

/** REMEZCLAR se lleva sólo lo que la publicada ya enseña, más el
 *  `/package.json` y el lock de una app (sin ellos no compila): las pruebas
 *  (`tests/`) y las migraciones (`supabase/`) del autor no son públicas. */
export function copyFolderForRemix(fromProjectId: string, toProjectId: string): Promise<number> {
  return copyProjectFiles(fromProjectId, toProjectId, isRemixedFolderPath);
}

/** DUPLICAR es tu propia carpeta: entera. */
export function copyFolderForDuplicate(fromProjectId: string, toProjectId: string): Promise<number> {
  return copyProjectFiles(fromProjectId, toProjectId, () => true);
}
