// LAS VERSIONES DE LOS FICHEROS DE LA CARPETA (pieza 9 de Len 2.5): el «antes»
// de cada cambio, para deshacer. Aparte de `projectVersions` (lib/db/schema.ts
// dice por qué). Como `restoreVersion` (versions.ts): restaurar archiva lo de
// ahora antes de escribir, así que el propio deshacer se deshace.
import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { deleteProjectFile, listProjectFiles, saveProjectFile } from "@/lib/backend/files";

const LIMIT_PER_PATH = 20;
const LABEL_MAX = 200;

export async function archiveFileVersion(p: {
  projectId: string;
  path: string;
  /** `null`: el fichero no existía (deshacer lo borra). */
  content: string | null;
  label: string;
  source: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(schema.projectFileVersions).values({ id, ...p, label: p.label.slice(0, LABEL_MAX) });
  const rows = await db
    .select({ id: schema.projectFileVersions.id })
    .from(schema.projectFileVersions)
    .where(and(eq(schema.projectFileVersions.projectId, p.projectId), eq(schema.projectFileVersions.path, p.path)))
    .orderBy(desc(schema.projectFileVersions.createdAt));
  const viejas = rows.slice(LIMIT_PER_PATH).map((r) => r.id);
  if (viejas.length > 0) await db.delete(schema.projectFileVersions).where(inArray(schema.projectFileVersions.id, viejas));
  return id;
}

/** Restaura una versión del dueño: escribe su contenido (o borra el fichero si
 *  la versión dice que no existía). `null` si la versión no es de ese proyecto
 *  y ese dueño. `versionPrevia`: la de lo que había justo antes. */
export async function restoreFileVersion(p: {
  projectId: string;
  userId: string;
  versionId: string;
}): Promise<{ path: string; content: string | null; versionPrevia: string } | null> {
  const [row] = await db
    .select({
      path: schema.projectFileVersions.path,
      content: schema.projectFileVersions.content,
      label: schema.projectFileVersions.label,
    })
    .from(schema.projectFileVersions)
    .innerJoin(schema.projects, eq(schema.projectFileVersions.projectId, schema.projects.id))
    .where(
      and(
        eq(schema.projectFileVersions.id, p.versionId),
        eq(schema.projectFileVersions.projectId, p.projectId),
        eq(schema.projects.userId, p.userId),
      ),
    )
    .limit(1);
  if (!row) return null;
  // `listProjectFiles` filtra por PREFIJO: aquí se quiere la ruta exacta.
  const actual = (await listProjectFiles(p.projectId, row.path))[row.path] ?? null;
  const versionPrevia = await archiveFileVersion({
    projectId: p.projectId,
    path: row.path,
    content: actual,
    label: `Before restoring "${row.label.slice(0, 60)}"`,
    source: "restore",
  });
  if (row.content === null) await deleteProjectFile(p.projectId, row.path);
  else await saveProjectFile(p.projectId, row.path, row.content);
  return { path: row.path, content: row.content, versionPrevia };
}
