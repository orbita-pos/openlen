import { FilesystemStorage } from "./filesystem";
import { R2Storage } from "./r2";
import type { StorageAdapter } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Model storage adapter.
//
// GLB assets live in a SEPARATE R2 bucket from user uploads and templates.
// Content-hash filenames (`models/glass-sphere-a3f4d2.glb`) mean each
// content version is an immutable URL — uploading new bytes creates a new
// object, the old URL stays valid indefinitely for rollback.
//
// Falls back to the local filesystem when R2_* env vars aren't set so
// local dev and self-host first-boot work without a Cloudflare account.
// Files land under `./public/model-objects/` and serve at `/model-objects/...`
// via Next's static handler.
// ─────────────────────────────────────────────────────────────────────────────

let cached: StorageAdapter | null = null;

export function getModelStorage(): StorageAdapter {
  if (cached) return cached;
  cached = buildStorage();
  return cached;
}

function buildStorage(): StorageAdapter {
  const {
    R2_ACCOUNT_ID,
    R2_ACCESS_KEY,
    R2_SECRET_KEY,
    R2_MODELS_BUCKET,
    R2_MODELS_PUBLIC_URL,
    MODELS_DIR,
    MODELS_PUBLIC_URL,
  } = process.env;

  if (R2_ACCOUNT_ID && R2_ACCESS_KEY && R2_SECRET_KEY) {
    return new R2Storage({
      accountId: R2_ACCOUNT_ID,
      accessKey: R2_ACCESS_KEY,
      secretKey: R2_SECRET_KEY,
      // Default to the existing curated-images bucket/domain (GLBs live under a
      // `models/` key prefix) so no new R2 bucket/DNS is needed — only a CORS
      // rule on it (GLTFLoader fetches the GLB cross-origin). Override with
      // R2_MODELS_BUCKET / R2_MODELS_PUBLIC_URL for a dedicated bucket.
      bucket: R2_MODELS_BUCKET || "openlen-images",
      publicUrlBase: R2_MODELS_PUBLIC_URL || "https://images.openlen.com",
    });
  }

  return new FilesystemStorage({
    rootDir: MODELS_DIR || "./public/model-objects",
    publicUrlBase: MODELS_PUBLIC_URL || "/model-objects",
  });
}

export function __setModelStorageForTest(adapter: StorageAdapter | null): void {
  cached = adapter;
}
