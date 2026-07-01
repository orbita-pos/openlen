import { auth } from "@/auth";
import { legacyWebp2000Variant, processImage } from "@/lib/images";
import {
  ACCEPTED_MIMES,
  extForMime,
  getAssetStorage,
  MAX_UPLOAD_BYTES,
} from "@/lib/projects/assets";
import { consumeToken, RATE_LIMITS, rateLimitedResponse } from "@/lib/rate-limit";

// POST /api/profiles/assets — upload a logo / photo for the user's business
// profile(s). Body: multipart/form-data with a single `file` field. Response:
// { url, filename, contentType, size }.
//
// User-scoped (namespace = userId) so it works BEFORE a profile is saved — no
// projectId, no chicken-egg. The stored asset is served by the public
// /api/projects/<userId>/assets/<file> GET route (LocalFs) or the R2 public URL
// (S3) — the same path/optimization as project assets.

export const runtime = "nodejs";

const ACCEPTED_MIME_SET = new Set<string>(ACCEPTED_MIMES);

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const userId = session.user.id;

  // Per-user upload rate limit — shared budget with the other image-upload
  // endpoints (key `upload:<userId>`).
  const rate = consumeToken(`upload:${userId}`, RATE_LIMITS.upload);
  if (!rate.allowed) return rateLimitedResponse(rate, "imágenes");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "invalid_form" }, 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "missing_file" }, 400);

  const size = file.size;
  if (size <= 0) return json({ error: "empty_file" }, 400);
  if (size > MAX_UPLOAD_BYTES) {
    return json(
      {
        error: "too_large",
        message: `Max upload size is ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`,
      },
      413,
    );
  }

  const mime = (file.type || "").toLowerCase();
  if (!ACCEPTED_MIME_SET.has(mime)) {
    return json(
      { error: "unsupported_type", message: `Allowed: ${ACCEPTED_MIMES.join(", ")}` },
      415,
    );
  }
  const ext = extForMime(mime);
  if (!ext) return json({ error: "unsupported_type" }, 415);

  let buffer: Buffer;
  try {
    buffer = Buffer.from(await file.arrayBuffer());
  } catch {
    return json({ error: "read_failed" }, 500);
  }

  // Optimize (downscale → WebP) unless SVG/GIF; ship the original on failure.
  let finalBuffer = buffer;
  let finalExt = ext;
  let finalMime = mime;
  if (mime !== "image/svg+xml" && mime !== "image/gif") {
    try {
      const { variants } = await processImage({
        input: buffer,
        variants: [legacyWebp2000Variant()],
        autoOrient: true,
        withoutEnlargement: true,
      });
      finalBuffer = variants[0].bytes;
      finalExt = "webp";
      finalMime = "image/webp";
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[profiles/assets] image optimization failed; using original", err);
    }
  }

  try {
    const storage = getAssetStorage();
    const meta = await storage.put(userId, finalBuffer, finalExt, finalMime);
    const url = /^https?:\/\//i.test(meta.url)
      ? meta.url
      : new URL(meta.url, req.url).href;
    return json({ ...meta, url, originalBytes: buffer.length }, 200);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[profiles/assets] put failed", err);
    return json(
      {
        error: "storage_failed",
        message: err instanceof Error ? err.message : "Unknown error",
      },
      500,
    );
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
