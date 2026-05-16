import { randomBytes } from "node:crypto";
import { auth } from "@/auth";
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
// Returns: { url, size, key }
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

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

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

  // Read the size BEFORE pulling the bytes into memory. Some clients still
  // populate file.size correctly even when sending a stream, and we'd rather
  // bail early on a huge upload than buffer it just to reject.
  if (file.size > MAX_SIZE_BYTES) {
    return json(
      { error: `File too large (${formatBytes(file.size)} > 5 MB max)` },
      413,
    );
  }

  if (!ALLOWED_MIME.has(file.type)) {
    return json(
      { error: `File type "${file.type || "unknown"}" not allowed. Allowed: JPEG, PNG, WebP, GIF.` },
      415,
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
  if (buffer.byteLength > MAX_SIZE_BYTES) {
    return json(
      { error: `File too large (${formatBytes(buffer.byteLength)} > 5 MB max)` },
      413,
    );
  }

  const ext = MIME_EXT[file.type] ?? "bin";
  const hash = randomBytes(8).toString("hex");
  const key = `uploads/${generationId}/${hash}.${ext}`;

  try {
    const result = await getStorage().upload({
      key,
      contentType: file.type,
      body: buffer,
    });
    return json({ url: result.url, size: result.size, key }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: `Upload failed: ${message}` }, 500);
  }
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
