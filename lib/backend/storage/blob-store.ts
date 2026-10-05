// Dónde viven los bytes de Storage. En producción, R2 (./r2-blob-store.ts;
// Jesús, 04/10); en las pruebas, la memoria. Supabase tiene lo mismo: su
// `StorageBackendAdapter`, con un backend `s3` y otro `file`.
//
// La clave de un objeto es la de su `StorageObjectLocator`:
// `<ref>/<bucket>/<name>/<version>`. Cada subida es una versión nueva, así que
// sustituir un fichero nunca pisa los bytes que otra petición aún está leyendo.

import { createHash } from "node:crypto";

import { ERRORS } from "./errors";

export interface PutOptions {
  readonly contentType: string;
  readonly cacheControl: string;
  /** Más bytes que esto: `EntityTooLarge` y no queda nada guardado. */
  readonly maxBytes: number;
}

export interface BlobStore {
  put(key: string, body: ReadableStream<Uint8Array>, o: PutOptions): Promise<{ size: number; eTag: string }>;
  /** `end` incluido, como en `Range: bytes=start-end`. */
  get(key: string, range?: { start: number; end?: number }): Promise<{ body: ReadableStream<Uint8Array>; size: number } | null>;
  delete(keys: readonly string[]): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  /** Borra todo lo que empieza por `prefix`; devuelve cuántos. */
  deletePrefix(prefix: string): Promise<number>;
}

export function blobKey(ref: string, bucketId: string, name: string, version: string): string {
  return `${ref}/${bucketId}/${name}/${version}`;
}

/** Lee un cuerpo entero sin pasar de `maxBytes`. Si se pasa, corta la lectura
 *  (no sigue bajando lo que quede) y lanza `EntityTooLarge`. */
export async function readLimited(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw ERRORS.EntityTooLarge();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

export function md5ETag(bytes: Uint8Array): string {
  return `"${createHash("md5").update(bytes).digest("hex")}"`;
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      if (bytes.byteLength) c.enqueue(bytes);
      c.close();
    },
  });
}

/** Para las pruebas: los blobs en un `Map`. */
export class MemoryBlobStore implements BlobStore {
  private readonly blobs = new Map<string, Uint8Array>();

  keys(): string[] {
    return [...this.blobs.keys()].sort();
  }

  async put(key: string, body: ReadableStream<Uint8Array>, o: PutOptions) {
    const bytes = await readLimited(body, o.maxBytes);
    this.blobs.set(key, bytes);
    return { size: bytes.byteLength, eTag: md5ETag(bytes) };
  }

  async get(key: string, range?: { start: number; end?: number }) {
    const bytes = this.blobs.get(key);
    if (!bytes) return null;
    const slice = range ? bytes.subarray(range.start, (range.end ?? bytes.byteLength - 1) + 1) : bytes;
    return { body: streamOf(slice), size: bytes.byteLength };
  }

  async delete(keys: readonly string[]) {
    for (const k of keys) this.blobs.delete(k);
  }

  async copy(from: string, to: string) {
    const bytes = this.blobs.get(from);
    if (!bytes) throw ERRORS.NoSuchKey();
    this.blobs.set(to, bytes);
  }

  async deletePrefix(prefix: string) {
    let n = 0;
    for (const k of [...this.blobs.keys()]) {
      if (k.startsWith(prefix)) {
        this.blobs.delete(k);
        n++;
      }
    }
    return n;
  }
}
