// Subir un fichero, como el `Uploader` de Supabase Storage (supabase/storage @
// eccef5e7, Apache-2.0: src/storage/uploader.ts y object.ts
// `uploadFromRequest`/`uploadNewObject`), en este orden:
//
//   1. El bucket, como superusuario: su límite y sus tipos.
//   2. El cuerpo: `multipart/form-data` (lo que manda storage-js con un Blob o
//      un File) o crudo; tipo, caché y metadatos de usuario; el tamaño
//      declarado contra el límite ANTES de leer nada.
//   3. RLS como el rol (`canUpload` = testPermission): si no deja, no se toca
//      el almacén.
//   4. Los bytes a una versión NUEVA (`<ref>/<bucket>/<name>/<uuid>`), cortando
//      al pasarse del límite.
//   5. La fila como `supabase_storage_admin`, con el objeto bloqueado (su
//      `waitObjectLock`): sin upsert y ya existe → 409.
//   6. Tras el commit, fuera el blob de la versión vieja; si algo falla, fuera
//      el nuevo. Nunca queda una fila que apunte a un blob que no existe.
//
// Lo nuestro: el tope de bytes del PROYECTO (el plan gratis de Supabase: 1 GB).

import { randomUUID } from "node:crypto";

import { blobKey } from "./blob-store";
import { asStorageAdmin, findBucket, findObject, insertObject, projectUsageBytes, testPermission, upsertObject, type ObjectMetadata } from "./db";
import { ERRORS, StorageError } from "./errors";
import type { StorageContext } from "./handler";
import { isEmptyFolder, mustBeValidKey, validateMimeType } from "./limits";

/** Su `MAX_CUSTOM_METADATA_SIZE`. */
const MAX_CUSTOM_METADATA_SIZE = 1024 * 1024;
/** Lo que ocupan las partes de un multipart además del fichero: los campos
 *  (`cacheControl`, `metadata` hasta 1 MB) y los separadores. */
const MULTIPART_SLACK = MAX_CUSTOM_METADATA_SIZE + 64 * 1024;

interface FileUpload {
  readonly body: ReadableStream<Uint8Array>;
  readonly mimeType: string;
  readonly cacheControl: string;
  readonly userMetadata: Record<string, unknown> | undefined;
  /** El tamaño que se sabe antes de leer (Content-Length o el del File). */
  readonly declaredLength: number | undefined;
}

function declaredContentLength(req: Request): number | undefined {
  const n = Number(req.headers.get("content-length"));
  return req.headers.has("content-length") && Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Un flujo que corta en cuanto pasa de `maxBytes`. */
function limitStream(body: ReadableStream<Uint8Array>, maxBytes: number, onTrip: () => void): ReadableStream<Uint8Array> {
  let seen = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, c) {
        seen += chunk.byteLength;
        if (seen > maxBytes) {
          onTrip();
          c.error(ERRORS.EntityTooLarge());
          return;
        }
        c.enqueue(chunk);
      },
    }),
  );
}

function parseUserMetadata(base64: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(Buffer.from(base64, "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** Su `fileUploadFromRequest`. */
async function fileUploadFromRequest(
  req: Request,
  o: { objectName: string; maxFileSize: number; allowedMimeTypes: readonly string[] },
): Promise<FileUpload> {
  const contentType = req.headers.get("content-type") ?? "";
  const checkMime = (mime: string) => {
    if (o.allowedMimeTypes.length > 0 && !isEmptyFolder(o.objectName)) validateMimeType(mime, o.allowedMimeTypes);
  };
  const declared = declaredContentLength(req);
  if (!req.body) throw ERRORS.NoContentProvided();

  if (contentType.startsWith("multipart/form-data")) {
    if (declared !== undefined && declared > o.maxFileSize + MULTIPART_SLACK) throw ERRORS.EntityTooLarge();
    let tripped = false;
    let form: FormData;
    try {
      const limited = limitStream(req.body, o.maxFileSize + MULTIPART_SLACK, () => {
        tripped = true;
      });
      form = await new Response(limited, { headers: { "content-type": contentType } }).formData();
    } catch (err) {
      if (tripped) throw ERRORS.EntityTooLarge();
      if (err instanceof StorageError) throw err;
      throw ERRORS.NoContentProvided((err as Error)?.message);
    }
    const file = [...form.values()].find((v): v is File => typeof v !== "string");
    if (!file) throw ERRORS.NoContentProvided();
    if (file.size > o.maxFileSize) throw ERRORS.EntityTooLarge();
    const field = (k: string) => {
      const v = form.get(k);
      return typeof v === "string" ? v : undefined;
    };
    const mimeType = field("contentType") || file.type || "application/octet-stream";
    checkMime(mimeType);
    const cacheTime = field("cacheControl");
    const customMd = field("metadata") ?? field("userMetadata");
    let userMetadata: Record<string, unknown> | undefined;
    if (customMd !== undefined) {
      if (Buffer.byteLength(customMd, "utf8") > MAX_CUSTOM_METADATA_SIZE) throw ERRORS.EntityTooLarge("user_metadata");
      try {
        userMetadata = JSON.parse(customMd) as Record<string, unknown>;
      } catch {
        // no-op, como Supabase
      }
    }
    return {
      body: file.stream(),
      mimeType,
      cacheControl: cacheTime ? `max-age=${cacheTime}` : "no-cache",
      userMetadata,
      declaredLength: file.size,
    };
  }

  const mimeType = contentType || "application/octet-stream";
  checkMime(mimeType);
  if (declared !== undefined && declared > o.maxFileSize) throw ERRORS.EntityTooLarge();
  const md = req.headers.get("x-metadata");
  return {
    body: req.body,
    mimeType,
    cacheControl: req.headers.get("cache-control") ?? "no-cache",
    userMetadata: md ? parseUserMetadata(md) : undefined,
    declaredLength: declared,
  };
}

export interface UploadResult {
  readonly id: string;
  /** `<bucket>/<name>`, el `Key` de su respuesta. */
  readonly path: string;
}

export async function uploadFromRequest(
  req: Request,
  ctx: StorageContext,
  bucketId: string,
  objectName: string,
  o: { isUpsert: boolean; owner?: string | undefined },
): Promise<UploadResult> {
  mustBeValidKey(objectName);
  const bucket = await asStorageAdmin(ctx, (q) => findBucket(q, bucketId));
  const global = ctx.limits.fileSizeLimit;
  const maxFileSize = isEmptyFolder(objectName) ? 0 : typeof bucket.file_size_limit === "number" ? Math.min(bucket.file_size_limit, global) : global;
  const file = await fileUploadFromRequest(req, { objectName, maxFileSize, allowedMimeTypes: bucket.allowed_mime_types ?? [] });
  const owner = o.owner;

  // El tope del proyecto, con lo que se sabe antes de leer.
  const used = await asStorageAdmin(ctx, (q) => projectUsageBytes(q));
  const quota = () => ERRORS.EntityTooLarge("project", "its storage limit");
  if (file.declaredLength !== undefined && used + file.declaredLength > ctx.limits.projectLimit) throw quota();

  // canUpload: RLS decide antes de tocar el almacén.
  const probe = { bucket_id: bucketId, name: objectName, version: "1", owner, metadata: { mimetype: file.mimeType, contentLength: file.declaredLength }, user_metadata: file.userMetadata };
  await testPermission(ctx, (q) => (o.isUpsert ? upsertObject(q, probe).then(() => undefined) : insertObject(q, probe)));

  const version = randomUUID();
  const key = blobKey(ctx.project.ref, bucketId, objectName, version);
  try {
    const put = await ctx.store.put(key, file.body, { contentType: file.mimeType, cacheControl: file.cacheControl, maxBytes: maxFileSize });
    if (used + put.size > ctx.limits.projectLimit) throw quota();
    const metadata: ObjectMetadata = {
      eTag: put.eTag,
      size: put.size,
      mimetype: file.mimeType,
      cacheControl: file.cacheControl,
      lastModified: new Date().toISOString(),
      contentLength: put.size,
      httpStatusCode: 200,
    };
    const { row, previous } = await asStorageAdmin(ctx, async (q) => {
      // Su `waitObjectLock`: dos subidas a la misma ruta, de una en una.
      await q(`select pg_advisory_xact_lock(hashtext($1))`, [`storage:${bucketId}/${objectName}`]);
      const current = await findObject(q, bucketId, objectName, { forUpdate: true, dontErrorOnEmpty: true });
      if (!o.isUpsert && current && current.version !== version) throw ERRORS.KeyAlreadyExists();
      const row = await upsertObject(q, { bucket_id: bucketId, name: objectName, owner, version, metadata, user_metadata: file.userMetadata ?? {} });
      return { row, previous: current?.version ?? null };
    });
    if (previous && previous !== version) {
      await ctx.store.delete([blobKey(ctx.project.ref, bucketId, objectName, previous)]).catch((err: unknown) => {
        console.error("[storage] no se pudo borrar la versión vieja", key, err);
      });
    }
    return { id: row.id, path: `${bucketId}/${objectName}` };
  } catch (err) {
    // Lo que se haya guardado de esta versión, fuera (borrar lo que no está no hace nada).
    await ctx.store.delete([key]).catch(() => {});
    throw err;
  }
}
