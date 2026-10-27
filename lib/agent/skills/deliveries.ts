/**
 * Where what `present` delivers is kept (spec local 2026-10-26-len-skills, §4.9): PRIVATE, served only
 * by the project's route (`/api/projects/<id>/deliveries/…`), which checks access.
 *
 * With R2, the private bucket the app already writes: the one of the pages' Storage
 * (`PAGES_STORAGE_R2_BUCKET`, no domain, nothing served from it directly), under `deliveries/`, which no
 * Storage scope can be (`SCOPE_RE`, `<20 letters>[_d|_l]`). Without R2, outside production, the
 * development private folder. Never the artifacts folder on the box: only its worker writes there
 * (infra/app/openlen-artifacts-worker.service), so Next would get EACCES.
 */
import { privateStorageFromEnv } from "@/lib/artifacts/private-storage";
import { readLimited, type BlobStore } from "@/lib/backend/storage/blob-store";
import { pageBlobStore } from "@/lib/backend/storage/r2-blob-store";

import { MAX_DELIVERABLE_BYTES } from "./present";

export interface DeliveryStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Null if there is no such file. */
  get(key: string): Promise<Uint8Array | null>;
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      if (bytes.byteLength) c.enqueue(bytes);
      c.close();
    },
  });
}

export function deliveryStoreFrom(blob: BlobStore | null, env: Readonly<Record<string, string | undefined>>): DeliveryStore | null {
  if (blob) {
    return {
      async put(key, bytes, contentType) {
        await blob.put(key, streamOf(bytes), { contentType, cacheControl: "private, no-store", maxBytes: MAX_DELIVERABLE_BYTES });
      },
      async get(key) {
        const found = await blob.get(key);
        return found ? readLimited(found.body, MAX_DELIVERABLE_BYTES) : null;
      },
    };
  }
  if (env.NODE_ENV === "production") return null;
  const local = () => privateStorageFromEnv(env);
  return {
    async put(key, bytes) {
      await (await local()).put(key, bytes);
    },
    async get(key) {
      try {
        return await (await local()).get(key);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
  };
}

/** This server's store for deliveries, or null if it has none. */
export function deliveryStore(env: Readonly<Record<string, string | undefined>> = process.env): DeliveryStore | null {
  return deliveryStoreFrom(pageBlobStore({ ...env }), env);
}
