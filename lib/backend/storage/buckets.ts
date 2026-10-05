// Las rutas de buckets de Supabase Storage (supabase/storage @ eccef5e7,
// Apache-2.0): src/http/routes/bucket/* y los métodos de bucket de
// src/storage/storage.ts. Cada una corre como el rol de la petición (RLS de
// `storage.buckets` manda), salvo lo que su código hace con `asSuperUser`.

import { blobKey } from "./blob-store";
import {
  asRole,
  asStorageAdmin,
  countObjectsInBucket,
  deleteBucket,
  findBucket,
  insertBucket,
  listBuckets,
  updateBucket,
  type ListBucketOptions,
} from "./db";
import { ERRORS } from "./errors";
import { json, readJsonBody, type StorageContext, type StorageRoute } from "./handler";
import { mustBeValidBucketName, normalizeAllowedMimeTypes, parseFileSizeToBytes, decodePathParam } from "./limits";

function ownerOf(ctx: StorageContext): string | undefined {
  return typeof ctx.claims.sub === "string" ? ctx.claims.sub : undefined;
}

/** Su `parseMaxSizeLimit`: número o «5MB», y nunca por encima del global. */
function parseMaxSizeLimit(ctx: StorageContext, v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "number" && typeof v !== "string") throw ERRORS.InvalidFileSizeLimit();
  const n = typeof v === "string" ? parseFileSizeToBytes(v) : v;
  if (n > ctx.limits.fileSizeLimit) throw ERRORS.EntityTooLarge();
  return n;
}

function mimeTypes(v: unknown): string[] | null | undefined {
  if (v === undefined || v === null) return v as null | undefined;
  if (!Array.isArray(v)) throw ERRORS.InvalidParameter("allowed_mime_types");
  const list = v.filter((m): m is string => typeof m === "string" && m.length > 0);
  return list.length ? normalizeAllowedMimeTypes(list) : list;
}

const decode = decodePathParam;

const createBucket: StorageRoute = {
  method: "POST",
  pattern: /^\/bucket\/?$/,
  async handle(req, ctx) {
    const b = await readJsonBody(req);
    const name = b.name;
    if (typeof name !== "string") throw ERRORS.InvalidRequest("body must have required property 'name'");
    const id = typeof b.id === "string" && b.id ? b.id : name;
    if (name.trim().length !== name.length) throw ERRORS.InvalidBucketName();
    mustBeValidBucketName(name);
    mustBeValidBucketName(id);
    const fileSizeLimit = parseMaxSizeLimit(ctx, b.file_size_limit);
    const allowed = mimeTypes(b.allowed_mime_types);
    await asRole(ctx, (q) =>
      insertBucket(q, { id, name, owner: ownerOf(ctx), public: b.public === true, file_size_limit: fileSizeLimit, allowed_mime_types: allowed }),
    );
    return json({ name });
  },
};

const SORT_COLUMNS = ["id", "name", "created_at", "updated_at"] as const;

const getAllBuckets: StorageRoute = {
  method: "GET",
  pattern: /^\/bucket\/?$/,
  async handle(req, ctx) {
    const sp = new URL(req.url).searchParams;
    const int = (k: string, min: number) => {
      const v = sp.get(k);
      if (v === null) return undefined;
      const n = Number(v);
      if (!Number.isInteger(n) || n < min) throw ERRORS.InvalidRequest(`querystring/${k} must be >= ${min}`);
      return n;
    };
    const sortColumn = sp.get("sortColumn") ?? undefined;
    if (sortColumn && !(SORT_COLUMNS as readonly string[]).includes(sortColumn)) {
      throw ERRORS.InvalidRequest("querystring/sortColumn must be equal to one of the allowed values");
    }
    const sortOrder = sp.get("sortOrder") ?? undefined;
    if (sortOrder && sortOrder !== "asc" && sortOrder !== "desc") {
      throw ERRORS.InvalidRequest("querystring/sortOrder must be equal to one of the allowed values");
    }
    const o: ListBucketOptions = {
      limit: int("limit", 1),
      offset: int("offset", 0),
      sortColumn: sortColumn as ListBucketOptions["sortColumn"],
      sortOrder: sortOrder as ListBucketOptions["sortOrder"],
      search: sp.get("search") ?? undefined,
    };
    return json(await asRole(ctx, (q) => listBuckets(q, o)));
  },
};

const getBucket: StorageRoute = {
  method: "GET",
  pattern: /^\/bucket\/([^/]+)\/?$/,
  async handle(_req, ctx, m) {
    const id = decode(m[1]!);
    return json(await asRole(ctx, (q) => findBucket(q, id)));
  },
};

const updateBucketRoute: StorageRoute = {
  method: "PUT",
  pattern: /^\/bucket\/([^/]+)\/?$/,
  async handle(req, ctx, m) {
    const id = decode(m[1]!);
    mustBeValidBucketName(id);
    const b = await readJsonBody(req);
    const fields = {
      public: typeof b.public === "boolean" ? b.public : undefined,
      file_size_limit: parseMaxSizeLimit(ctx, b.file_size_limit),
      allowed_mime_types: mimeTypes(b.allowed_mime_types),
    };
    if (!Object.values(fields).some((v) => v !== undefined)) throw ERRORS.NoContentProvided();
    await asRole(ctx, (q) => updateBucket(q, id, fields));
    return json({ message: "Successfully updated" });
  },
};

const deleteBucketRoute: StorageRoute = {
  method: "DELETE",
  pattern: /^\/bucket\/([^/]+)\/?$/,
  async handle(_req, ctx, m) {
    const id = decode(m[1]!);
    // storage.ts `deleteBucket`: mirar y contar como superusuario, con el
    // bucket bloqueado; borrar como el rol (RLS decide).
    await asRole(ctx, async (q) => {
      await q(`select set_config('role', 'supabase_storage_admin', true)`);
      await findBucket(q, id, { forUpdate: true });
      if ((await countObjectsInBucket(q, id, 1)) > 0) throw ERRORS.BucketNotEmpty();
      await q(`select set_config('role', $1, true)`, [ctx.role]);
      if ((await deleteBucket(q, id)) === 0) throw ERRORS.NoSuchBucket();
    });
    return json({ message: "Successfully deleted" });
  },
};

/** En Supabase, `emptyBucket` es de las rutas `serviceRoleOnly`. Allí lo
 *  borra una cola; aquí, en el momento, con el mismo mensaje. */
const emptyBucket: StorageRoute = {
  method: "POST",
  pattern: /^\/bucket\/([^/]+)\/empty\/?$/,
  async handle(_req, ctx, m) {
    if (ctx.role !== "service_role") throw ERRORS.AccessDenied("Access denied: Invalid role").withStatusCode(403);
    const id = decode(m[1]!);
    await asRole(ctx, (q) => findBucket(q, id));
    const gone = await asStorageAdmin(ctx, async (q) => {
      const r = await q(`delete from storage.objects where bucket_id = $1 returning name, version`, [id]);
      return r.rows as { name: string; version: string | null }[];
    });
    await ctx.store.delete(gone.filter((o) => o.version).map((o) => blobKey(ctx.project.ref, id, o.name, o.version!)));
    return json({ message: "Empty bucket has been queued. Completion may take up to an hour." });
  },
};

export const BUCKET_ROUTES: readonly StorageRoute[] = [createBucket, getAllBuckets, emptyBucket, getBucket, updateBucketRoute, deleteBucketRoute];
