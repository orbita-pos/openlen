// Las rutas de objetos de Supabase Storage (supabase/storage @ eccef5e7,
// Apache-2.0): src/http/routes/object/{createObject,updateObject,getObject,
// getObjectInfo}.ts.
//
// Quién ve qué, como su `getObject`: el bucket se mira como superusuario; sin
// clave ni JWT (una ruta abierta), sólo lo de un bucket público; en un bucket
// público el objeto se busca sin RLS, y en uno privado CON RLS.

import { randomUUID } from "node:crypto";

import { blobKey } from "./blob-store";
import {
  asRole,
  asStorageAdmin,
  deleteObjects,
  findBucket,
  findObject,
  insertObject,
  searchObjects,
  testPermission,
  updateObject,
  upsertObject,
  type ObjectRow,
} from "./db";
import { ERRORS } from "./errors";
import { json, readJsonBody, type StorageContext, type StorageRoute } from "./handler";
import { MAX_OBJECTS_PER_REQUEST, mustBeValidKey, decodePathParam } from "./limits";
import { objectHeaders, parseRangeHeader } from "./serve-headers";
import { uploadFromRequest } from "./upload";

const decode = decodePathParam;

/** Su `MAX_OBJECTS_PER_DELETE_BATCH`. */
const MAX_OBJECTS_PER_DELETE_BATCH = Math.floor(1000 / 2);

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

const updateObjectRoute: StorageRoute = {
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

const str = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !v) throw ERRORS.InvalidRequest(`body must have required property '${field}'`);
  return v;
};

/** listObjects.ts: `storage.search` como el rol. */
const listObjects: StorageRoute = {
  method: "POST",
  pattern: /^\/object\/list\/([^/]+)\/?$/,
  async handle(req, ctx, m) {
    const b = await readJsonBody(req);
    const sortBy = (b.sortBy ?? {}) as { column?: string; order?: string };
    // object.ts `searchObjects`: el prefijo es siempre una carpeta.
    let prefix = typeof b.prefix === "string" ? b.prefix : "";
    if (prefix.length > 0 && !prefix.endsWith("/")) prefix = `${prefix}/`;
    const rows = await asRole(ctx, (q) =>
      searchObjects(q, decode(m[1]!), prefix, {
        limit: typeof b.limit === "number" ? b.limit : undefined,
        offset: typeof b.offset === "number" ? b.offset : undefined,
        search: typeof b.search === "string" ? b.search : undefined,
        sortBy,
      }),
    );
    return json(rows);
  },
};

/** deleteObjects.ts + object.ts `deleteObjects`: como el rol (lo que RLS no
 *  deja no se borra), por lotes, y los blobs de lo borrado. */
const deleteObjectsRoute: StorageRoute = {
  method: "DELETE",
  pattern: /^\/object\/([^/]+)\/?$/,
  async handle(req, ctx, m) {
    const bucketId = decode(m[1]!);
    const b = await readJsonBody(req);
    const prefixes = b.prefixes;
    if (!Array.isArray(prefixes) || prefixes.some((p) => typeof p !== "string")) throw ERRORS.InvalidRequest("body must have required property 'prefixes'");
    if (prefixes.length > MAX_OBJECTS_PER_REQUEST) {
      throw ERRORS.InvalidRequest(`Bulk object requests are limited to ${MAX_OBJECTS_PER_REQUEST} objects per request.`);
    }
    const results: ObjectRow[] = [];
    for (let i = 0; i < prefixes.length; i += MAX_OBJECTS_PER_DELETE_BATCH) {
      const batch = prefixes.slice(i, i + MAX_OBJECTS_PER_DELETE_BATCH) as string[];
      const gone = await asRole(ctx, (q) => deleteObjects(q, bucketId, batch));
      await ctx.store.delete(gone.filter((o) => o.version).map((o) => blobKey(ctx.project.ref, bucketId, o.name, o.version!)));
      results.push(...gone);
    }
    return json(results);
  },
};

/** moveObject.ts + object.ts `moveObject`. */
const moveObject: StorageRoute = {
  method: "POST",
  pattern: /^\/object\/move\/?$/,
  async handle(req, ctx) {
    const b = await readJsonBody(req);
    const bucketId = str(b.bucketId, "bucketId");
    const sourceKey = str(b.sourceKey, "sourceKey");
    const destinationKey = str(b.destinationKey, "destinationKey");
    const destinationBucket = typeof b.destinationBucket === "string" && b.destinationBucket ? b.destinationBucket : bucketId;
    mustBeValidKey(destinationKey);
    const owner = ownerOf(ctx);
    const newVersion = randomUUID();
    // RLS: ¿puede este rol ver el origen y dejarlo con su nombre nuevo?
    await testPermission(ctx, async (q) => {
      await findObject(q, bucketId, sourceKey);
      await updateObject(q, bucketId, sourceKey, { name: destinationKey, bucket_id: destinationBucket, version: newVersion, owner });
    });
    const source = await asStorageAdmin(ctx, (q) => findObject(q, bucketId, sourceKey));
    const from = blobKey(ctx.project.ref, bucketId, sourceKey, source.version ?? "");
    const to = blobKey(ctx.project.ref, destinationBucket, destinationKey, newVersion);
    if (bucketId === destinationBucket && sourceKey === destinationKey) {
      return json({ message: "Successfully moved", Id: source.id, Key: source.name });
    }
    await ctx.store.copy(from, to);
    try {
      const moved = await asStorageAdmin(ctx, async (q) => {
        await q(`select pg_advisory_xact_lock(hashtext($1))`, [`storage:${destinationBucket}/${destinationKey}`]);
        const current = await findObject(q, bucketId, sourceKey, { forUpdate: true });
        const row = await updateObject(q, bucketId, sourceKey, {
          name: destinationKey,
          bucket_id: destinationBucket,
          version: newVersion,
          owner,
          metadata: current.metadata,
          user_metadata: current.user_metadata,
        });
        return { row, oldVersion: current.version };
      });
      if (moved.oldVersion) await ctx.store.delete([blobKey(ctx.project.ref, bucketId, sourceKey, moved.oldVersion)]).catch(() => {});
      return json({ message: "Successfully moved", Id: moved.row.id, Key: moved.row.name });
    } catch (err) {
      await ctx.store.delete([to]).catch(() => {});
      throw err;
    }
  },
};

/** copyObject.ts + object.ts `copyObject` (con `copyMetadata`, su valor por defecto). */
const copyObject: StorageRoute = {
  method: "POST",
  pattern: /^\/object\/copy\/?$/,
  async handle(req, ctx) {
    const b = await readJsonBody(req);
    const bucketId = str(b.bucketId, "bucketId");
    const sourceKey = str(b.sourceKey, "sourceKey");
    const destinationKey = str(b.destinationKey, "destinationKey");
    const destinationBucket = typeof b.destinationBucket === "string" && b.destinationBucket ? b.destinationBucket : bucketId;
    const upsert = req.headers.get("x-upsert") === "true";
    mustBeValidKey(destinationKey);
    const owner = ownerOf(ctx);
    const origin = await asRole(ctx, (q) => findObject(q, bucketId, sourceKey));
    const probe = { bucket_id: destinationBucket, name: destinationKey, version: "1", owner, metadata: origin.metadata, user_metadata: origin.user_metadata };
    await testPermission(ctx, (q) => (upsert ? upsertObject(q, probe).then(() => undefined) : insertObject(q, probe)));
    const newVersion = randomUUID();
    const to = blobKey(ctx.project.ref, destinationBucket, destinationKey, newVersion);
    await ctx.store.copy(blobKey(ctx.project.ref, bucketId, sourceKey, origin.version ?? ""), to);
    try {
      const { row, previous } = await asStorageAdmin(ctx, async (q) => {
        await q(`select pg_advisory_xact_lock(hashtext($1))`, [`storage:${destinationBucket}/${destinationKey}`]);
        const existing = await findObject(q, destinationBucket, destinationKey, { forUpdate: true, dontErrorOnEmpty: true });
        if (existing && !upsert) throw ERRORS.KeyAlreadyExists();
        const row = await upsertObject(q, {
          bucket_id: destinationBucket,
          name: destinationKey,
          owner,
          version: newVersion,
          metadata: { ...(origin.metadata ?? {}), lastModified: new Date().toISOString() },
          user_metadata: origin.user_metadata,
        });
        return { row, previous: existing?.version ?? null };
      });
      if (previous) await ctx.store.delete([blobKey(ctx.project.ref, destinationBucket, destinationKey, previous)]).catch(() => {});
      return json({ Id: row.id, Key: `${destinationBucket}/${destinationKey}`, ...row });
    } catch (err) {
      await ctx.store.delete([to]).catch(() => {});
      throw err;
    }
  },
};

/** En orden: las rutas con prefijo fijo antes que `/object/:bucket/*`. */
export const OBJECT_ROUTES: readonly StorageRoute[] = [
  listObjects,
  moveObject,
  copyObject,
  deleteObjectsRoute,
  infoPublic,
  getPublic("GET"),
  getPublic("HEAD"),
  info("authenticated/", false),
  info("", true),
  get("authenticated/", false),
  head("authenticated/", false),
  createObject,
  updateObjectRoute,
  get("", true),
  head("", true),
];
