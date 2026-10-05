// Los bytes de Storage en Cloudflare R2 (Jesús, 04/10: «R2»), por su API de
// S3, como el backend `s3` de Supabase Storage (src/storage/backend/s3/).
//
// Un bucket de R2 propio y PRIVADO (`PAGES_STORAGE_R2_BUCKET`, por defecto
// `openlen-page-storage`) con las credenciales que ya usa la app
// (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY`, `R2_SECRET_KEY`). Nada se sirve desde R2
// directamente: lo público y lo privado salen por /storage/v1, que pone las
// cabeceras (lib/backend/storage/serve-headers.ts).
//
// Subir: con un solo trozo, `PutObject`; si pasa de 8 MiB, por partes
// (`CreateMultipartUpload` + `UploadPart` + `CompleteMultipartUpload`, lo que
// hace `@aws-sdk/lib-storage`, sin esa dependencia). Pasarse de `maxBytes` o
// que el cuerpo se corte: `AbortMultipartUpload`, y no queda nada.

import { ERRORS } from "./errors";
import type { BlobStore, PutOptions } from "./blob-store";

/** Un comando de S3 por su nombre (`PutObject`…) y su entrada. */
export type S3Send = (name: string, input: Record<string, unknown>) => Promise<Record<string, unknown>>;

const PART_SIZE = 8 * 1024 * 1024;
const DELETE_BATCH = 1000;

function concat(chunks: readonly Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** El nombre de un error de S3 (`NoSuchKey`…), venga del SDK o de un doble. */
function s3ErrorName(err: unknown): string | undefined {
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } } | null;
  if (e?.$metadata?.httpStatusCode === 404) return "NoSuchKey";
  return e?.name ?? e?.Code;
}

export class R2BlobStore implements BlobStore {
  readonly bucket: string;
  private readonly send: S3Send;

  constructor(o: { send: S3Send; bucket: string }) {
    this.send = o.send;
    this.bucket = o.bucket;
  }

  async put(key: string, body: ReadableStream<Uint8Array>, o: PutOptions): Promise<{ size: number; eTag: string }> {
    const reader = body.getReader();
    let pending: Uint8Array[] = [];
    let pendingSize = 0;
    let total = 0;
    let uploadId: string | null = null;
    const parts: { ETag: string; PartNumber: number }[] = [];
    const common = { Bucket: this.bucket, Key: key };

    const uploadPart = async (bytes: Uint8Array) => {
      if (!uploadId) {
        const r = await this.send("CreateMultipartUpload", { ...common, ContentType: o.contentType, CacheControl: o.cacheControl });
        uploadId = String(r.UploadId);
      }
      const PartNumber = parts.length + 1;
      const r = await this.send("UploadPart", { ...common, UploadId: uploadId, PartNumber, Body: bytes, ContentLength: bytes.byteLength });
      parts.push({ ETag: String(r.ETag), PartNumber });
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > o.maxBytes) {
          await reader.cancel().catch(() => {});
          throw ERRORS.EntityTooLarge();
        }
        pending.push(value);
        pendingSize += value.byteLength;
        while (pendingSize >= PART_SIZE) {
          const all = concat(pending, pendingSize);
          await uploadPart(all.subarray(0, PART_SIZE));
          const rest = all.subarray(PART_SIZE);
          pending = rest.byteLength ? [rest] : [];
          pendingSize = rest.byteLength;
        }
      }
      if (!uploadId) {
        const bytes = concat(pending, pendingSize);
        const r = await this.send("PutObject", {
          ...common,
          Body: bytes,
          ContentLength: bytes.byteLength,
          ContentType: o.contentType,
          CacheControl: o.cacheControl,
        });
        return { size: total, eTag: String(r.ETag) };
      }
      if (pendingSize > 0) await uploadPart(concat(pending, pendingSize));
      const r = await this.send("CompleteMultipartUpload", { ...common, UploadId: uploadId, MultipartUpload: { Parts: parts } });
      return { size: total, eTag: String(r.ETag) };
    } catch (err) {
      if (uploadId) await this.send("AbortMultipartUpload", { ...common, UploadId: uploadId }).catch(() => {});
      throw err;
    }
  }

  async get(key: string, range?: { start: number; end?: number }) {
    let r: Record<string, unknown>;
    try {
      r = await this.send("GetObject", {
        Bucket: this.bucket,
        Key: key,
        ...(range ? { Range: `bytes=${range.start}-${range.end ?? ""}` } : {}),
      });
    } catch (err) {
      if (s3ErrorName(err) === "NoSuchKey") return null;
      throw err;
    }
    const raw = r.Body as { transformToWebStream?: () => ReadableStream<Uint8Array> } | ReadableStream<Uint8Array> | undefined;
    const body =
      raw && typeof (raw as { transformToWebStream?: unknown }).transformToWebStream === "function"
        ? (raw as { transformToWebStream: () => ReadableStream<Uint8Array> }).transformToWebStream()
        : (raw as ReadableStream<Uint8Array> | undefined) ?? new Response(null).body!;
    const total = typeof r.ContentRange === "string" ? Number(/\/(\d+)$/.exec(r.ContentRange)?.[1]) : Number(r.ContentLength);
    return { body, size: total };
  }

  async delete(keys: readonly string[]) {
    for (let i = 0; i < keys.length; i += DELETE_BATCH) {
      const batch = keys.slice(i, i + DELETE_BATCH);
      if (batch.length === 0) continue;
      await this.send("DeleteObjects", { Bucket: this.bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } });
    }
  }

  async copy(from: string, to: string) {
    const source = `${this.bucket}/${from.split("/").map(encodeURIComponent).join("/")}`;
    await this.send("CopyObject", { Bucket: this.bucket, Key: to, CopySource: source });
  }

  async deletePrefix(prefix: string) {
    let n = 0;
    let token: string | undefined;
    do {
      const r = await this.send("ListObjectsV2", { Bucket: this.bucket, Prefix: prefix, ...(token ? { ContinuationToken: token } : {}) });
      const keys = ((r.Contents as { Key?: string }[] | undefined) ?? []).map((c) => c.Key).filter((k): k is string => typeof k === "string");
      await this.delete(keys);
      n += keys.length;
      token = r.IsTruncated ? (r.NextContinuationToken as string | undefined) : undefined;
    } while (token);
    return n;
  }
}

/** El `send` de verdad: carga `@aws-sdk/client-s3` la primera vez (como
 *  lib/storage/r2.ts) y arma `<nombre>Command`. */
function sdkSend(env: Record<string, string | undefined>): S3Send {
  let ready: Promise<{ client: { send(c: unknown): Promise<unknown> }; sdk: Record<string, unknown> }> | null = null;
  return async (name, input) => {
    ready ??= (async () => {
      const sdk = (await import("@aws-sdk/client-s3")) as unknown as Record<string, unknown>;
      const S3Client = sdk.S3Client as new (c: unknown) => { send(c: unknown): Promise<unknown> };
      const client = new S3Client({
        region: "auto",
        endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: env.R2_ACCESS_KEY, secretAccessKey: env.R2_SECRET_KEY },
      });
      return { client, sdk };
    })();
    const { client, sdk } = await ready;
    const Command = sdk[`${name}Command`] as new (i: unknown) => unknown;
    return (await client.send(new Command(input))) as Record<string, unknown>;
  };
}

let cached: { key: string; store: R2BlobStore } | null = null;

/** El almacén de este servidor, o null sin credenciales de R2. */
export function pageBlobStore(env: Record<string, string | undefined> = process.env): BlobStore | null {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY } = env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY || !R2_SECRET_KEY) return null;
  const bucket = env.PAGES_STORAGE_R2_BUCKET?.trim() || "openlen-page-storage";
  const key = `${R2_ACCOUNT_ID}|${R2_ACCESS_KEY}|${bucket}`;
  if (cached?.key !== key) cached = { key, store: new R2BlobStore({ send: sdkSend(env), bucket }) };
  return cached.store;
}
