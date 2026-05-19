import { FilesystemStorage } from "./filesystem";
import { R2Storage } from "./r2";
import type { StorageAdapter } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Template storage adapter.
//
// Templates live in a SEPARATE R2 bucket from user uploads. Two reasons:
//   1. Different cache policy. Template objects use content-hash filenames
//      (`templates/anchor-a3f4d2.html`) and are served with long s-maxage —
//      uploading a new version creates a new object, the old URL still
//      points to the old immutable content.
//   2. Different access pattern. Templates are read by every gallery visitor
//      (cacheable globally at the CDN edge); uploads tend to be one-off.
//
// Falls back to the local filesystem when R2_* env vars aren't set, so
// local dev and self-host first-boot keep working without a Cloudflare
// account. Files land under `./public/template-objects/` and serve at
// `/template-objects/...` via Next's static handler.
// ─────────────────────────────────────────────────────────────────────────────

let cached: StorageAdapter | null = null;

export function getTemplateStorage(): StorageAdapter {
  if (cached) return cached;
  cached = buildStorage();
  return cached;
}

function buildStorage(): StorageAdapter {
  const {
    R2_ACCOUNT_ID,
    R2_ACCESS_KEY,
    R2_SECRET_KEY,
    R2_TEMPLATES_BUCKET,
    R2_TEMPLATES_PUBLIC_URL,
    TEMPLATES_DIR,
    TEMPLATES_PUBLIC_URL,
  } = process.env;

  if (R2_ACCOUNT_ID && R2_ACCESS_KEY && R2_SECRET_KEY) {
    return new R2Storage({
      accountId: R2_ACCOUNT_ID,
      accessKey: R2_ACCESS_KEY,
      secretKey: R2_SECRET_KEY,
      bucket: R2_TEMPLATES_BUCKET || "openlen-templates",
      publicUrlBase: R2_TEMPLATES_PUBLIC_URL || "https://templates.openlen.com",
    });
  }

  return new FilesystemStorage({
    rootDir: TEMPLATES_DIR || "./public/template-objects",
    publicUrlBase: TEMPLATES_PUBLIC_URL || "/template-objects",
  });
}

export function __setTemplateStorageForTest(adapter: StorageAdapter | null): void {
  cached = adapter;
}
