// URLs firmadas de Supabase Storage (supabase/storage @ eccef5e7, Apache-2.0):
// las rutas getSignedURL, getSignedURLs, getSignedObject, getSignedUploadURL y
// uploadSignedObject, y `signObjectUrl`/`signObjectUrls`/`signUploadObjectUrl`/
// `verifyObjectSignature` de src/storage/object.ts.
//
// El token es un JWT HS256 con el secreto del proyecto y un `scope` (`download`
// o `upload`): sin él, un JWT de sesión no puede pasar por una URL firmada.
// Firmar pide que RLS deje ver (o subir); usar la URL, no pide nada.

import { errors as joseErrors, jwtVerify } from "jose";

import { signJwt } from "../keys";
import { asRole, asStorageAdmin, findObject, findObjects, insertObject, testPermission, upsertObject } from "./db";
import { ERRORS } from "./errors";
import { json, readJsonBody, type StorageContext, type StorageRoute } from "./handler";
import { MAX_OBJECTS_PER_REQUEST, mustBeValidKey } from "./limits";
import { serveObject } from "./objects";
import { uploadFromRequest } from "./upload";

// src/internal/auth/jwt.ts
const SIGNED_URL_SCOPE_DOWNLOAD = "download";
const SIGNED_URL_SCOPE_UPLOAD = "upload";
const MAX_ABSOLUTE_JWT_EXPIRATION_SECONDS = Math.floor(Number.MAX_SAFE_INTEGER / 1000);
/** Su `uploadSignedUrlExpirationTime` por defecto: dos horas. */
const UPLOAD_SIGNED_URL_EXPIRATION = 7200;

const decode = (s: string) => decodeURIComponent(s);

function ownerOf(ctx: StorageContext): string | undefined {
  return typeof ctx.claims.sub === "string" ? ctx.claims.sub : undefined;
}

/** Su `assertValidNumericJWTExpiration`. */
function assertValidExpiresIn(expiresIn: unknown): number {
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn)) throw ERRORS.InvalidParameter("expiresIn");
  const s = Math.floor(expiresIn);
  const max = Math.max(0, MAX_ABSOLUTE_JWT_EXPIRATION_SECONDS - Math.floor(Date.now() / 1000));
  if (!Number.isSafeInteger(s) || s < 1 || s > max) throw ERRORS.InvalidParameter("expiresIn");
  return s;
}

type Scope = typeof SIGNED_URL_SCOPE_DOWNLOAD | typeof SIGNED_URL_SCOPE_UPLOAD;

/** Su `verifyObjectSignature`. */
async function verifyObjectSignature(
  ctx: StorageContext,
  token: string | null,
  bucketId: string,
  objectName: string,
  scope: Scope,
): Promise<Record<string, unknown>> {
  if (!token) throw ERRORS.InvalidRequest("querystring must have required property 'token'");
  let payload: Record<string, unknown>;
  try {
    payload = (await jwtVerify(token, new TextEncoder().encode(ctx.project.jwtSecret), { algorithms: ["HS256"] })).payload as Record<string, unknown>;
  } catch (err) {
    throw ERRORS.InvalidJWT(err instanceof joseErrors.JOSEError || err instanceof Error ? err.message : undefined);
  }
  const ok =
    scope === SIGNED_URL_SCOPE_UPLOAD
      ? payload.scope === SIGNED_URL_SCOPE_UPLOAD || (payload.scope === undefined && "upsert" in payload)
      : payload.scope === SIGNED_URL_SCOPE_DOWNLOAD || (payload.scope === undefined && !("upsert" in payload));
  if (!ok) throw ERRORS.InvalidSignature(`Token is not scoped for ${scope}`);
  if (payload.url !== `${bucketId}/${objectName}`) throw ERRORS.InvalidSignature();
  if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) throw ERRORS.ExpiredSignature();
  return payload;
}

/** POST /object/sign/:bucket/* — getSignedURL.ts. */
const signUrl: StorageRoute = {
  method: "POST",
  pattern: /^\/object\/sign\/([^/]+)\/(.+)$/,
  async handle(req, ctx, m) {
    const bucketId = decode(m[1]!);
    const objectName = decode(m[2]!);
    const b = await readJsonBody(req);
    const expiresIn = assertValidExpiresIn(b.expiresIn);
    await asRole(ctx, (q) => findObject(q, bucketId, objectName));
    // `urlParts.splice(3)` de su `signObjectUrl`, sobre la ruta pedida.
    const urlToSign = decodeURI(ctx.path.split("/").splice(3).join("/"));
    const token = await signJwt(ctx.project.jwtSecret, { url: urlToSign, scope: SIGNED_URL_SCOPE_DOWNLOAD }, expiresIn);
    return json({ signedURL: `/object/sign/${urlToSign}?token=${token}` });
  },
};

/** POST /object/sign/:bucket — getSignedURLs.ts. */
const signUrls: StorageRoute = {
  method: "POST",
  pattern: /^\/object\/sign\/([^/]+)\/?$/,
  async handle(req, ctx, m) {
    const bucketId = decode(m[1]!);
    const b = await readJsonBody(req);
    const expiresIn = assertValidExpiresIn(b.expiresIn);
    const paths = b.paths;
    if (!Array.isArray(paths) || paths.some((p) => typeof p !== "string")) throw ERRORS.InvalidRequest("body must have required property 'paths'");
    const found = new Set<string>();
    for (let i = 0; i < paths.length; i += MAX_OBJECTS_PER_REQUEST) {
      const rows = await asRole(ctx, (q) => findObjects(q, bucketId, paths.slice(i, i + MAX_OBJECTS_PER_REQUEST) as string[]));
      for (const r of rows) found.add(r.name);
    }
    const out = await Promise.all(
      (paths as string[]).map(async (path) => {
        if (!found.has(path)) return { error: "Either the object does not exist or you do not have access to it", path, signedURL: null };
        const urlToSign = `${bucketId}/${path}`;
        const token = await signJwt(ctx.project.jwtSecret, { url: urlToSign, scope: SIGNED_URL_SCOPE_DOWNLOAD }, expiresIn);
        return { error: null, path, signedURL: `/object/sign/${urlToSign}?token=${token}` };
      }),
    );
    return json(out);
  },
};

/** GET /object/sign/:bucket/*?token= — getSignedObject.ts (abierta). */
const getSigned: StorageRoute = {
  method: "GET",
  pattern: /^\/object\/sign\/([^/]+)\/(.+)$/,
  open: true,
  async handle(req, ctx, m) {
    const bucketId = decode(m[1]!);
    const objectName = decode(m[2]!);
    const payload = await verifyObjectSignature(ctx, new URL(req.url).searchParams.get("token"), bucketId, objectName, SIGNED_URL_SCOPE_DOWNLOAD);
    const obj = await asStorageAdmin(ctx, (q) => findObject(q, bucketId, objectName));
    const res = await serveObject(req, ctx, bucketId, obj, { visibility: "private" });
    // Su renderer pone `Expires` con el `exp` del token.
    res.headers.set("Expires", new Date((payload.exp as number) * 1000).toUTCString());
    return res;
  },
};

/** POST /object/upload/sign/:bucket/* — getSignedUploadURL.ts. */
const signUpload: StorageRoute = {
  method: "POST",
  pattern: /^\/object\/upload\/sign\/([^/]+)\/(.+)$/,
  async handle(req, ctx, m) {
    const bucketId = decode(m[1]!);
    const objectName = decode(m[2]!);
    mustBeValidKey(objectName);
    const owner = ownerOf(ctx);
    const upsert = req.headers.get("x-upsert") === "true";
    const url = `${bucketId}/${objectName}`;
    const probe = { bucket_id: bucketId, name: objectName, version: "1", owner, metadata: { mimetype: req.headers.get("content-type") ?? undefined }, user_metadata: undefined };
    await testPermission(ctx, (q) => (upsert ? upsertObject(q, probe).then(() => undefined) : insertObject(q, probe)));
    const token = await signJwt(ctx.project.jwtSecret, { owner, url, upsert, scope: SIGNED_URL_SCOPE_UPLOAD }, UPLOAD_SIGNED_URL_EXPIRATION);
    return json({ url: `/object/upload/sign/${url}?token=${token}`, token });
  },
};

/** PUT /object/upload/sign/:bucket/*?token= — uploadSignedObject.ts (abierta). */
const uploadSigned: StorageRoute = {
  method: "PUT",
  pattern: /^\/object\/upload\/sign\/([^/]+)\/(.+)$/,
  open: true,
  async handle(req, ctx, m) {
    const bucketId = decode(m[1]!);
    const objectName = decode(m[2]!);
    const payload = await verifyObjectSignature(ctx, new URL(req.url).searchParams.get("token"), bucketId, objectName, SIGNED_URL_SCOPE_UPLOAD);
    const r = await uploadFromRequest(req, ctx, bucketId, objectName, {
      isUpsert: payload.upsert === true,
      owner: typeof payload.owner === "string" ? payload.owner : undefined,
      skipPermission: true,
    });
    return json({ Key: r.path });
  },
};

/** Antes que las de objetos: `/object/sign/…` también casaría con `/object/:bucket/*`. */
export const SIGNED_ROUTES: readonly StorageRoute[] = [signUrls, signUrl, getSigned, signUpload, uploadSigned];

