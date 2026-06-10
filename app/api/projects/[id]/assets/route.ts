import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { legacyWebp2000Variant, processImage } from "@/lib/images";
import {
  ACCEPTED_AUDIO_MIMES,
  ACCEPTED_MIMES,
  extForMime,
  getAssetStorage,
  MAX_AUDIO_UPLOAD_BYTES,
  MAX_UPLOAD_BYTES,
} from "@/lib/projects/assets";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/[id]/assets — upload an image or audio asset for a
// project (audio feeds the page-music player; settings.music.src points here).
//
// Body: multipart/form-data with a single `file` field.
// Response: { url, filename, contentType, size }
//
// Auth: user must own the project. The asset is stored under that project's
// namespace (LocalFs: <upload-dir>/<id>/<hash>.<ext>; S3: <id>/<hash>.<ext>).
// Hash-based filename means re-uploading the same file is idempotent.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";

const ACCEPTED_MIME_SET = new Set<string>(ACCEPTED_MIMES);
const ACCEPTED_AUDIO_MIME_SET = new Set<string>(ACCEPTED_AUDIO_MIMES);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;

  // Verify ownership before touching the upload.
  const rows = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, id),
        eq(schema.projects.userId, session.user.id),
      ),
    )
    .limit(1);
  if (rows.length === 0) return json({ error: "not_found" }, 404);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "invalid_form" }, 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return json({ error: "missing_file" }, 400);
  }

  const mime = (file.type || "").toLowerCase();
  const isAudio = ACCEPTED_AUDIO_MIME_SET.has(mime);
  if (!ACCEPTED_MIME_SET.has(mime) && !isAudio) {
    return json(
      {
        error: "unsupported_type",
        message: `Allowed types: ${[...ACCEPTED_MIMES, ...ACCEPTED_AUDIO_MIMES].join(", ")}`,
      },
      415,
    );
  }

  const size = file.size;
  const maxBytes = isAudio ? MAX_AUDIO_UPLOAD_BYTES : MAX_UPLOAD_BYTES;
  if (size <= 0) return json({ error: "empty_file" }, 400);
  if (size > maxBytes) {
    return json(
      {
        error: "too_large",
        message: `Max upload size is ${Math.floor(maxBytes / 1024 / 1024)} MB`,
      },
      413,
    );
  }

  const ext = extForMime(mime);
  if (!ext) return json({ error: "unsupported_type" }, 415);

  let buffer: Buffer;
  try {
    const arr = await file.arrayBuffer();
    buffer = Buffer.from(arr);
  } catch {
    return json({ error: "read_failed" }, 500);
  }

  // Optimize before storage. Audio bypasses entirely (stored as-is). SVG
  // (vector) and GIF (animation) bypass too — the Rust pipeline can't
  // preserve either (vector → raster lossy; animation → single frame).
  // Everything else: downscale to 2000px max on the longer edge + WebP at
  // quality 85. On any pipeline failure ship the original — the page still
  // works, just heavier.
  let finalBuffer = buffer;
  let finalExt = ext;
  let finalMime = mime;
  if (!isAudio && mime !== "image/svg+xml" && mime !== "image/gif") {
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
      console.warn("[projects/assets] image optimization failed; using original", err);
    }
  }

  try {
    const storage = getAssetStorage();
    const meta = await storage.put(id, finalBuffer, finalExt, finalMime);
    // storage.put can return a RELATIVE url (LocalFs without
    // OPENLEN_APP_BASE_URL). A relative url breaks on the published
    // subdomain AND is silently dropped by the chat's attached-image flow
    // (its `new URL()` check can't parse a relative string). Resolve to an
    // absolute url against the request origin so it's always usable.
    const url = /^https?:\/\//i.test(meta.url)
      ? meta.url
      : new URL(meta.url, req.url).href;
    return json(
      {
        ...meta,
        url,
        originalBytes: buffer.length,
      },
      200,
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[projects/assets] put failed", err);
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
