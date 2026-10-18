import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";

/** projects.envHash tracks PRODUCTION vars. A draft needs its own witness;
 * only the digest is read, and no environment value enters an image URL. */
export function draftEnvVersionSql(projectId: SQL): SQL<string> {
  return sql<string>`(select md5(coalesce(jsonb_object_agg(v.name, v.value order by v.name), '{}'::jsonb)::text)
    from "projectEnvVars" v where v."projectId" = ${projectId} and v.target = 'draft')`;
}

export interface DraftThumbnailSource {
  readonly id: string;
  readonly title?: string | null;
  readonly logoUrl?: string | null;
  readonly subdomain?: string | null;
  readonly publishedAt?: Date | string | null;
  readonly status?: string;
  readonly thumbnailUrl?: string | null;
  readonly filesHash?: string | null;
  readonly envHash?: string | null;
  readonly draftEnvVersion: string | null;
  readonly data?: { readonly html?: string | null; readonly app?: unknown; readonly settings?: unknown } | null;
}

/** Only visible inputs: a memory note or chat message is not a new picture. */
export function draftThumbnailRevision(p: DraftThumbnailSource): string {
  return createHash("sha256").update(JSON.stringify([
    "draft-preview-v1", p.data?.html, p.data?.app, p.data?.settings,
    p.title, p.logoUrl, p.filesHash, p.envHash, p.draftEnvVersion,
  ])).digest("hex").slice(0, 16);
}

export function needsDraftThumbnail(p: DraftThumbnailSource): boolean {
  if (p.subdomain || p.publishedAt || p.status === "archived" || !p.data?.html?.trim()) return false;
  // The URL records the source revision as well as the image's content hash.
  // Old thumbnails have no revision and are refreshed once, without a migration.
  return !p.thumbnailUrl?.includes(`/${p.id}-draft-${draftThumbnailRevision(p)}-`);
}
