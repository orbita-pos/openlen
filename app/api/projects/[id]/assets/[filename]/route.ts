import { getAssetStorage } from "@/lib/projects/assets";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/[id]/assets/[filename] — serve a previously uploaded
// asset for inclusion in the iframe preview AND in published pages.
//
// Public on purpose: published landing pages must be readable by anonymous
// visitors, and the same URL is used for editing + publishing.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; filename: string }> },
): Promise<Response> {
  const { id, filename } = await params;
  if (!id || !filename) {
    return new Response("not_found", { status: 404 });
  }

  let result;
  try {
    const storage = getAssetStorage();
    result = await storage.get(id, filename);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[projects/assets] get failed", err);
    return new Response("storage_error", { status: 500 });
  }

  if (!result) return new Response("not_found", { status: 404 });

  // Copy into a fresh ArrayBuffer so the BodyInit type checker is happy
  // (some runtime defs reject SharedArrayBuffer-backed views).
  const ab = new ArrayBuffer(result.contents.byteLength);
  new Uint8Array(ab).set(result.contents);
  const blob = new Blob([ab], { type: result.contentType });

  return new Response(blob, {
    status: 200,
    headers: {
      "content-type": result.contentType,
      // Hash-based filename → immutable forever once written.
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
