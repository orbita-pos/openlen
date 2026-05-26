import { createHash } from "node:crypto";
import { getStorage } from "@/lib/storage";
import { decodeDataUri } from "./extract-logo";

// ─────────────────────────────────────────────────────────────────────────────
// Persist a base64 data: URI into object storage and return a real URL.
//
// Used when a publish-time logo extraction (or an inspector upload) hands us
// an inline data: URI we'd otherwise have to embed in DB + every published
// HTML. Hashes the bytes so identical favicons across projects dedupe.
//
// Returns null when the URI isn't a recognized image / can't be decoded —
// the caller should keep the raw data: URI as-is in that case (still works
// in the browser, just keeps the bloat).
// ─────────────────────────────────────────────────────────────────────────────

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
};

const MAX_BYTES = 2 * 1024 * 1024; // 2MB — bigger and it shouldn't be a logo

export async function uploadDataUriToStorage(
  dataUri: string,
  pathPrefix = "logos",
): Promise<string | null> {
  const decoded = decodeDataUri(dataUri);
  if (!decoded) return null;
  if (decoded.body.byteLength === 0 || decoded.body.byteLength > MAX_BYTES) {
    return null;
  }
  const mime = decoded.contentType.toLowerCase();
  const ext = EXT_BY_MIME[mime];
  if (!ext) return null;

  const hash = createHash("sha256")
    .update(decoded.body)
    .digest("hex")
    .slice(0, 16);
  const key = `${pathPrefix}/${hash}.${ext}`;

  try {
    const result = await getStorage().upload({
      key,
      contentType: mime,
      body: decoded.body,
    });
    return result.url;
  } catch {
    return null;
  }
}
