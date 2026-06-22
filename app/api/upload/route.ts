import { randomBytes } from "node:crypto";
import { auth } from "@/auth";
import {
  fallbackFormatForMime,
  OpenLenImageError,
  processImage,
  uploadResponsiveVariantSet,
  type ImageFormat,
} from "@/lib/images";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/upload
//
// multipart/form-data:
//   file:           the image (image/jpeg|png|webp|gif, ≤5MB)
//   generationId:   the page this image belongs to (used to scope the key,
//                   so a future delete-all-images-for-page operation is one
//                   prefix list). Optional — falls back to "anon".
//
// Pipeline (per @openlen/images, replacing the sharp Node binding):
//   - JPEG/PNG/WebP input → decode → EXIF auto-rotate → fan-out to
//     {200, 400, 800}w × {webp, avif} + one legacy fallback at 800w.
//     Upload all variants in parallel; respond with `{ url, variants[] }`
//     where `url` points at the largest fallback (back-compat with the
//     pre-variant response shape — existing callers that only read `.url`
//     keep working).
//   - GIF input → bypass (decoding + re-encoding would strip animation).
//     Upload the bytes as-is and respond with an empty `variants[]`.
//
// Auth: required. Anonymous uploads would let any visitor burn through
// storage quota and dump arbitrary files on the public domain. No quota /
// rate-limit yet — Session 10+ when storage costs become a real lever.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

// Self-hosted video for the cinematic showcase (hero loops + short clips).
// Stored as-is — no transcode (creators pre-encode) — and served from R2; the
// published page references it via <video src> (born-static, CSP-safe: the
// seal never touches <video>). 50 MB cap (a 30s 720p clip is ~5 MB).
const MAX_VIDEO_SIZE_BYTES = 50 * 1024 * 1024;
const ALLOWED_VIDEO_MIME = new Map<string, string>([
  ["video/mp4", "mp4"],
  ["video/webm", "webm"],
  ["video/quicktime", "mov"],
]);

function extForFormat(fmt: ImageFormat): string {
  switch (fmt) {
    case "jpeg":
      return "jpg";
    case "png":
      return "png";
    case "webp":
      return "webp";
    case "avif":
      return "avif";
  }
}

interface UploadedVariant {
  width: number;
  height: number;
  format: ImageFormat;
  mime: string;
  url: string;
  size: number;
  key: string;
}

interface UploadPlaceholder {
  /** Woltapp BlurHash string (~30 chars at 4×3 components). */
  blurhash: string;
  /** Hex `#RRGGBB` of the source's dominant color. */
  dominantColor: string;
  /** Thumb width the placeholder was computed from. */
  width: number;
  /** Thumb height (paired with `width`). */
  height: number;
}

interface UploadResponse {
  /** Primary URL — the largest legacy-fallback variant (JPEG/PNG at 800w)
   *  for processed uploads, or the pass-through original for GIF. Matches
   *  the field the pre-variants response shape exposed; existing callers
   *  (properties-panel.tsx) only read this. */
  url: string;
  /** Bytes of the primary file (matches the URL). */
  size: number;
  /** Storage key of the primary file. */
  key: string;
  /** All produced variants. Empty for GIF pass-through. */
  variants: UploadedVariant[];
  /** BlurHash + dominant color for LQIP rendering on the client.
   *  Absent for GIF pass-through (no decode → no placeholder). */
  placeholder?: UploadPlaceholder;
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return json({ error: "unauthorized" }, 401);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "Expected multipart/form-data body" }, 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return json({ error: "Missing 'file' field" }, 400);
  }

  const isVideo = ALLOWED_VIDEO_MIME.has(file.type);
  const isImage = ALLOWED_MIME.has(file.type);
  if (!isVideo && !isImage) {
    return json(
      { error: `File type "${file.type || "unknown"}" not allowed. Allowed: JPEG, PNG, WebP, GIF, MP4, WebM, MOV.` },
      415,
    );
  }
  const maxBytes = isVideo ? MAX_VIDEO_SIZE_BYTES : MAX_SIZE_BYTES;
  const maxLabel = isVideo ? "50 MB" : "5 MB";

  // Read the size BEFORE pulling the bytes into memory. Some clients still
  // populate file.size correctly even when sending a stream, and we'd rather
  // bail early on a huge upload than buffer it just to reject.
  if (file.size > maxBytes) {
    return json(
      { error: `File too large (${formatBytes(file.size)} > ${maxLabel} max)` },
      413,
    );
  }

  const generationIdRaw = form.get("generationId");
  const generationId =
    typeof generationIdRaw === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(generationIdRaw)
      ? generationIdRaw
      : "anon";

  const buffer = Buffer.from(await file.arrayBuffer());
  // Defensive: clients can lie about size in the multipart envelope. The real
  // size lives in the buffer we just allocated.
  if (buffer.byteLength > maxBytes) {
    return json(
      { error: `File too large (${formatBytes(buffer.byteLength)} > ${maxLabel} max)` },
      413,
    );
  }

  const hash = randomBytes(8).toString("hex");
  const storage = getStorage();

  // ─── Video pass-through ──────────────────────────────────────────────────
  // No decode/transcode — store the bytes as-is and return the URL. The page
  // references it via <video src>; the publish seal leaves <video> intact.
  if (isVideo) {
    const ext = ALLOWED_VIDEO_MIME.get(file.type)!;
    const key = `uploads/${generationId}/${hash}.${ext}`;
    try {
      const result = await storage.upload({ key, contentType: file.type, body: buffer });
      const body: UploadResponse = { url: result.url, size: result.size, key, variants: [] };
      return json(body, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return json({ error: `Upload failed: ${message}` }, 500);
    }
  }

  // ─── GIF pass-through ──────────────────────────────────────────────────
  // Re-encoding an animated GIF would either strip the animation (sharp's
  // default) or balloon the file with first-frame-only WebP. Keeping it
  // untouched matches what sharp does and lets reaction GIFs render
  // correctly on the published page.
  if (file.type === "image/gif") {
    const key = `uploads/${generationId}/${hash}.gif`;
    try {
      const result = await storage.upload({
        key,
        contentType: file.type,
        body: buffer,
      });
      const body: UploadResponse = {
        url: result.url,
        size: result.size,
        key,
        variants: [],
      };
      return json(body, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return json({ error: `Upload failed: ${message}` }, 500);
    }
  }

  // ─── Variant pipeline ──────────────────────────────────────────────────
  const fallback = fallbackFormatForMime(file.type);
  const variantSpec = uploadResponsiveVariantSet(fallback);

  let processed;
  try {
    processed = await processImage({
      input: buffer,
      variants: variantSpec,
      autoOrient: true,
      withoutEnlargement: true,
      placeholder: true,
    });
  } catch (err) {
    if (err instanceof OpenLenImageError) {
      // Decode failure on user-supplied bytes → 422 (the bytes are bad).
      // Encode / invalid_input fall through to 500 — those would be our
      // bugs, not the user's.
      const status = err.kind === "decode" ? 422 : 500;
      return json(
        { error: `Image processing failed: ${err.message}`, kind: err.kind },
        status,
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: `Image processing failed: ${message}` }, 500);
  }

  let uploaded: UploadedVariant[];
  try {
    uploaded = await Promise.all(
      processed.variants.map(async (v) => {
        const ext = extForFormat(v.format);
        const key = `uploads/${generationId}/${hash}_${v.width}w.${ext}`;
        const result = await storage.upload({
          key,
          contentType: v.mime,
          body: v.bytes,
        });
        return {
          width: v.width,
          height: v.height,
          format: v.format,
          mime: v.mime,
          url: result.url,
          size: result.size,
          key,
        };
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: `Upload failed: ${message}` }, 500);
  }

  // Primary = the largest legacy fallback. uploadResponsiveVariantSet
  // always includes one, but defend against future changes.
  const primary =
    uploaded.find((u) => u.format === fallback) ?? uploaded[uploaded.length - 1];

  const body: UploadResponse = {
    url: primary.url,
    size: primary.size,
    key: primary.key,
    variants: uploaded,
    placeholder: processed.placeholder
      ? {
          blurhash: processed.placeholder.blurhash,
          dominantColor: processed.placeholder.dominantColor,
          width: processed.placeholder.width,
          height: processed.placeholder.height,
        }
      : undefined,
  };
  return json(body, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
