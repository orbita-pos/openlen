import { FilesystemStorage } from "./filesystem";
import { R2Storage } from "./r2";
import type { StorageAdapter } from "./types";

export type { StorageAdapter, UploadArgs, UploadResult } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Factory: choose an adapter based on env. R2 wins when all three credential
// vars are set; otherwise we fall back to filesystem (which works out of the
// box without configuration).
//
// The choice is cached at module-init time, so calling `getStorage()` from a
// request handler is essentially free.
// ─────────────────────────────────────────────────────────────────────────────

let cached: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (cached) return cached;
  cached = buildStorage();
  return cached;
}

function buildStorage(): StorageAdapter {
  const {
    R2_ACCOUNT_ID,
    R2_ACCESS_KEY,
    R2_SECRET_KEY,
    R2_BUCKET,
    R2_PUBLIC_URL,
    UPLOADS_DIR,
    UPLOADS_PUBLIC_URL,
  } = process.env;

  if (R2_ACCOUNT_ID && R2_ACCESS_KEY && R2_SECRET_KEY) {
    return new R2Storage({
      accountId: R2_ACCOUNT_ID,
      accessKey: R2_ACCESS_KEY,
      secretKey: R2_SECRET_KEY,
      bucket: R2_BUCKET || "openlen-uploads",
      publicUrlBase: R2_PUBLIC_URL || "https://uploads.openlen.com",
    });
  }

  return new FilesystemStorage({
    rootDir: UPLOADS_DIR || "./public/uploads",
    publicUrlBase: UPLOADS_PUBLIC_URL || "/uploads",
  });
}

// Test-seam: lets the eval / unit tests inject a mock adapter without going
// through env-var manipulation.
export function __setStorageForTest(adapter: StorageAdapter | null): void {
  cached = adapter;
}
