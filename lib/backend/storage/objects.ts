// Las rutas de objetos de Supabase Storage (supabase/storage @ eccef5e7,
// Apache-2.0): src/http/routes/object/{createObject,updateObject,getObject,
// getObjectInfo}.ts.
//
// Quién ve qué, como su `getObject`: el bucket se mira como superusuario; sin
// clave ni JWT (una ruta abierta), sólo lo de un bucket público; en un bucket
// público el objeto se busca sin RLS, y en uno privado CON RLS.

import { blobKey } from "./blob-store";
import { asRole, asStorageAdmin, findBucket, findObject, type ObjectRow } from "./db";
import { ERRORS } from "./errors";
import { json, type StorageContext, type StorageRoute } from "./handler";
import { objectHeaders, parseRangeHeader } from "./serve-headers";
import { uploadFromRequest } from "./upload";

const decode = (s: string) => decodeURIComponent(s);

function ownerOf(ctx: StorageContext): string | undefined {
  return typeof ctx.claims.sub === "string" ? ctx.claims.sub : undefined;
}

/** El objeto que esta petición puede ver, o el error de Supabase. */
export async function visibleObject(
  ctx: StorageContext,
  bucketId: string,
  name: string,
  o: { publicRoute?: boolean } = {},
): Promise<{ obj: ObjectRow; isPublic: boolean }> {
  const bucket = await asStorageAdmin(ctx, (q) => findBucket(q, bucketId, { dontErrorOnEmpty: true }));
  if (!ctx.authenticated && !bucket?.public) throw ERRORS.NoSuchBucket();
  if (!bucket) throw ERRORS.NoSuchBucket();
  if (o.publicRoute && !bucket.public) throw ERRORS.NoSuchBucket();
  const obj =
    bucket.public || o.publicRoute
      ? await asStorageAdmin(ctx, (q) => findObject(q, bucketId, name))
      : await asRole(ctx, (q) => findObject(q, bucketId, name));
  return { obj, isPublic: bucket.public };
}

/** Bajar: los bytes del almacén con las cabeceras del objeto. */
export async function serveObject(
  req: Request,
  ctx: StorageContext,
  bucketId: string,
  obj: ObjectRow,
  o: { visibility: "public" | "private"; head?: boolean },
): Promise<Response> {
  const meta = obj.metadata ?? {};
  const download = new URL(req.url).searchParams.get("download") ?? undefined;
  const headers = objectHeaders(meta, { visibility: o.visibility, download });
  if (!obj.version) throw ERRORS.NoSuchKey();
  if (o.head) {
    if (typeof meta.size === "number") headers.set("Content-Length", String(meta.size));
    return new Response(null, { status: 200, headers });
  }
  const key = blobKey(ctx.project.ref, bucketId, obj.name, obj.version);
  const rangeHeader = req.headers.get("range");
  if (rangeHeader && typeof meta.size === "number") {
    const range = parseRangeHeader(rangeHeader, meta.size);
    const blob = await ctx.store.get(key, { start: range.fromByte, end: range.toByte });
    if (!blob) throw ERRORS.NoSuchKey();
    headers.set("Content-Length", String(range.size));
    headers.set("Content-Range", `bytes ${range.fromByte}-${range.toByte}/${meta.size}`);
    return new Response(blob.body, { status: 206, headers });
  }
  const blob = await ctx.store.get(key);
  if (!blob) throw ERRORS.NoSuchKey();
  headers.set("Content-Length", String(blob.size));
  return new Response(blob.body, { status: 200, headers });
}

/** `info`: su `InfoRenderer`. */
function infoResponse(obj: ObjectRow): Response {
  const meta = obj.metadata ?? ({} as Partial<NonNullable<ObjectRow["metadata"]>>);
  const headers: Record<string, string> = {};
  if (meta.eTag) headers.ETag = meta.eTag;
  if (meta.cacheControl) headers["Cache-Control"] = meta.cacheControl;
  return json(
    {
      id: obj.id,
      name: obj.name,
      version: obj.version,
      bucket_id: obj.bucket_id,
      size: meta.size ?? null,
      content_type: meta.mimetype ?? null,
      cache_control: meta.cacheControl ?? null,
      etag: meta.eTag ?? null,
      metadata: obj.user_metadata,
      last_modified: obj.updated_at,
      created_at: obj.created_at,
    },
    200,
    headers,
  );
}

const OBJ = (prefix: string) => new RegExp(`^/object/${prefix}([^/]+)/(.+)$`);

const createObject: StorageRoute = {
  method: "POST",
  pattern: OBJ(""),
  async handle(req, ctx, m) {
    const r = await uploadFromRequest(req, ctx, decode(m[1]!), decode(m[2]!), {
      isUpsert: req.headers.get("x-upsert") === "true",
      owner: ownerOf(ctx),
    });
    return json({ Id: r.id, Key: r.path });
  },
};

const updateObject: StorageRoute = {
  method: "PUT",
  pattern: OBJ(""),
  async handle(req, ctx, m) {
    const r = await uploadFromRequest(req, ctx, decode(m[1]!), decode(m[2]!), { isUpsert: true, owner: ownerOf(ctx) });
    return json({ Id: r.id, Key: r.path });
  },
};

const get = (prefix: string, open: boolean): StorageRoute => ({
  method: "GET",
  pattern: OBJ(prefix),
  open,
  async handle(req, ctx, m) {
    const bucketId = decode(m[1]!);
    const { obj, isPublic } = await visibleObject(ctx, bucketId, decode(m[2]!));
    return serveObject(req, ctx, bucketId, obj, { visibility: isPublic ? "public" : "private" });
  },
});

const head = (prefix: string, open: boolean): StorageRoute => ({
  method: "HEAD",
  pattern: OBJ(prefix),
  open,
  async handle(req, ctx, m) {
    const bucketId = decode(m[1]!);
    const { obj, isPublic } = await visibleObject(ctx, bucketId, decode(m[2]!));
    return serveObject(req, ctx, bucketId, obj, { visibility: isPublic ? "public" : "private", head: true });
  },
});

const info = (prefix: string, open: boolean): StorageRoute => ({
  method: "GET",
  pattern: OBJ(`info/${prefix}`),
  open,
  async handle(_req, ctx, m) {
    const { obj } = await visibleObject(ctx, decode(m[1]!), decode(m[2]!));
    return infoResponse(obj);
  },
});

/** getPublicObject.ts: sólo un bucket público, todo como superusuario, sin
 *  pedir nada (lo que `getPublicUrl` arma en el navegador). */
const getPublic = (method: "GET" | "HEAD"): StorageRoute => ({
  method,
  pattern: OBJ("public/"),
  open: true,
  async handle(req, ctx, m) {
    const bucketId = decode(m[1]!);
    await asStorageAdmin(ctx, (q) => findBucket(q, bucketId, { isPublic: true }));
    const obj = await asStorageAdmin(ctx, (q) => findObject(q, bucketId, decode(m[2]!)));
    return serveObject(req, ctx, bucketId, obj, { visibility: "public", head: method === "HEAD" });
  },
});

const infoPublic: StorageRoute = {
  method: "GET",
  pattern: OBJ("info/public/"),
  open: true,
  async handle(_req, ctx, m) {
    const { obj } = await visibleObject(ctx, decode(m[1]!), decode(m[2]!), { publicRoute: true });
    return infoResponse(obj);
  },
};

/** En orden: las rutas con prefijo fijo antes que `/object/:bucket/*`. */
export const OBJECT_ROUTES: readonly StorageRoute[] = [
  infoPublic,
  getPublic("GET"),
  getPublic("HEAD"),
  info("authenticated/", false),
  info("", true),
  get("authenticated/", false),
  head("authenticated/", false),
  createObject,
  updateObject,
  get("", true),
  head("", true),
];
