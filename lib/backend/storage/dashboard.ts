// El panel del dueño, pestaña Storage (`?view=database`): lo que enseña el
// navegador de ficheros de Supabase. Como el editor de tablas
// (lib/backend/dashboard.ts), el dueño lo ve TODO: va como `service_role`, que
// salta RLS. Los ficheros se abren con una URL firmada de 10 minutos, la misma
// que da `createSignedUrl`: nada nuevo que asegurar.

import { signJwt } from "../keys";
import type { BackendProject } from "../router";
import { blobKey } from "./blob-store";
import { asRole, deleteObjects } from "./db";
import { storeFor, type StorageContext } from "./handler";
import { storageLimits } from "./limits";

export interface PanelBucket {
  readonly id: string;
  readonly public: boolean;
  readonly files: number;
  readonly bytes: number;
  readonly fileSizeLimit: number | null;
  readonly allowedMimeTypes: readonly string[] | null;
}

export interface PanelFile {
  readonly name: string;
  readonly size: number | null;
  readonly mimetype: string | null;
  readonly updatedAt: string | null;
  /** Para abrirlo: `/object/sign/…` con un token de 10 minutos. */
  readonly url: string;
}

const MAX_FILES = 500;
const LINK_SECONDS = 600;

function serviceContext(project: BackendProject): StorageContext {
  return {
    project,
    store: storeFor(project) as StorageContext["store"],
    role: "service_role",
    claims: { role: "service_role" },
    jwt: "",
    authenticated: true,
    limits: project.storage?.limits ?? storageLimits(),
    method: "GET",
    path: "/panel",
  };
}

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));

export async function listStorageBuckets(project: BackendProject): Promise<PanelBucket[]> {
  const rows = await asRole(serviceContext(project), async (q) =>
    (
      await q(`
        select b.id, b.public, b.file_size_limit::text as file_size_limit, b.allowed_mime_types,
               count(o.id)::int as files, coalesce(sum((o.metadata->>'size')::bigint), 0)::text as bytes
          from storage.buckets b
          left join storage.objects o on o.bucket_id = b.id and o.archived_at is null
         group by b.id
         order by b.id`)
    ).rows,
  );
  return rows.map((r) => ({
    id: String(r.id),
    public: r.public === true,
    files: Number(r.files),
    bytes: Number(r.bytes),
    fileSizeLimit: r.file_size_limit === null ? null : Number(r.file_size_limit),
    allowedMimeTypes: (r.allowed_mime_types as string[] | null) ?? null,
  }));
}

/** `projectUrl`: `https://<ref>.openlen.app` (lo da lib/backend/owner-access.ts). */
export async function listBucketFiles(project: BackendProject, projectUrl: string, bucketId: string): Promise<PanelFile[]> {
  const rows = await asRole(serviceContext(project), async (q) =>
    (
      await q(
        `select name, metadata, updated_at from storage.objects
          where bucket_id = $1 and archived_at is null
          order by name collate "C" limit ${MAX_FILES}`,
        [bucketId],
      )
    ).rows,
  );
  return Promise.all(
    rows.map(async (r) => {
      const name = String(r.name);
      const meta = (r.metadata ?? {}) as { size?: number; mimetype?: string };
      const urlToSign = `${bucketId}/${name}`;
      const token = await signJwt(project.jwtSecret, { url: urlToSign, scope: "download" }, LINK_SECONDS);
      return {
        name,
        size: typeof meta.size === "number" ? meta.size : null,
        mimetype: typeof meta.mimetype === "string" ? meta.mimetype : null,
        updatedAt: iso(r.updated_at),
        url: `${projectUrl}/storage/v1/object/sign/${urlToSign.split("/").map(encodeURIComponent).join("/")}?token=${token}`,
      };
    }),
  );
}

export async function deleteStorageFile(project: BackendProject, bucketId: string, name: string): Promise<{ ok: true } | { error: string }> {
  const ctx = serviceContext(project);
  if (!ctx.store) return { error: "Storage is not available on this server" };
  const gone = await asRole(ctx, (q) => deleteObjects(q, bucketId, [name]));
  if (gone.length === 0) return { error: "Object not found" };
  await ctx.store.delete(gone.filter((o) => o.version).map((o) => blobKey(project.ref, bucketId, o.name, o.version!)));
  return { ok: true };
}
