import "server-only";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { listProjectFiles } from "@/lib/backend/files";
import { entornoPublicoDeLaApp } from "@/lib/apps/entorno";
import { hayTurnoVivoEnElProyecto } from "@/lib/agent/direcciones";
import { thumbnailsEnabled } from "@/lib/publish/kill-switches";
import { folderFingerprint } from "./files-hash";
import { draftThumbnailRevision, needsDraftThumbnail, draftEnvVersionSql } from "./thumbnail-state";
import { renderProjectThumbnail } from "./thumbnail";

/** Called after a complete turn, or when the list discovers an old/missing
 * image. No model calls, no publishing, no updatedAt changes. */
export async function refreshDraftThumbnail(projectId: string, force = false): Promise<boolean> {
  if (!thumbnailsEnabled()) return true;
  if (hayTurnoVivoEnElProyecto(projectId)) return false;
  const [p] = await db.select({
    id: schema.projects.id, title: schema.projects.title, logoUrl: schema.projects.logoUrl,
    subdomain: schema.projects.subdomain, publishedAt: schema.projects.publishedAt,
    status: schema.projects.status, thumbnailUrl: schema.projects.thumbnailUrl,
    filesHash: schema.projects.filesHash, envHash: schema.projects.envHash,
    draftEnvVersion: draftEnvVersionSql(sql`${schema.projects}."id"`),
    data: schema.projects.data, updatedAt: sql<string>`${schema.projects.updatedAt}::text`,
  }).from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1);
  if (!p || p.subdomain || p.publishedAt || p.status === "archived" || !p.data?.html?.trim()) return true;
  if (!force && !needsDraftThumbnail(p)) return true;
  const files = await listProjectFiles(projectId);
  // A file write and its filesHash update are separate statements. Retry if
  // we landed between them; never label the new files with the old revision.
  if (p.filesHash !== null && folderFingerprint(files) !== p.filesHash) return false;
  const entorno = p.data.app ? await entornoPublicoDeLaApp(projectId, "draft") : undefined;
  const result = await renderProjectThumbnail({
    projectId, html: p.data.html,
    view: { projectId, title: p.title, sub: null, pagina: null, logoUrl: p.logoUrl, settings: p.data.settings, app: p.data.app, files, entorno },
    draft: { revision: draftThumbnailRevision(p), updatedAt: p.updatedAt, filesHash: p.filesHash, envHash: p.envHash, draftEnvVersion: p.draftEnvVersion },
  });
  if (!result) throw new Error(`Draft thumbnail capture was not saved for ${projectId}`);
  return true;
}
