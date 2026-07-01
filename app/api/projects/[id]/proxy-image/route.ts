import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { consumeToken, RATE_LIMITS, rateLimitedResponse } from "@/lib/rate-limit";
import { validateUrl } from "@/lib/style-match/scrape/validate-url";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/[id]/proxy-image?url=<encoded> — same-origin image fetch.
//
// The in-place image editor (crop / remove-bg / AI) runs in the browser and
// needs the RAW BYTES of the image being edited. Displaying a cross-origin
// image (an <img> or background-image) needs no CORS, but reading its bytes via
// fetch()/canvas DOES — and our own asset host (R2 images.openlen.com) and
// Unsplash don't send Access-Control-Allow-Origin. So the client falls back to
// this endpoint: the server fetches the image (no CORS in play) and streams it
// back same-origin.
//
// SSRF-guarded (validateUrl blocks loopback/RFC-1918/link-local + non-image
// schemes) and project-scoped (auth + ownership) so it can't be used as an open
// proxy. Redirects are refused — following them would bypass the host check.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 15 * 1024 * 1024;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return new Response("unauthorized", { status: 401 });
  const { id } = await params;

  // Ownership gate — only the project owner can proxy through this route.
  const rows = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, id), eq(schema.projects.userId, userId)))
    .limit(1);
  if (rows.length === 0) return new Response("not_found", { status: 404 });

  const target = new URL(req.url).searchParams.get("url");
  if (!target) return new Response("missing_url", { status: 400 });

  const valid = await validateUrl(target);
  if (!valid.ok) return new Response("blocked", { status: 400 });

  // Per-user rate limit before the upstream fetch — caps egress amplification
  // (each proxied image is up to 15 MB). A blocked/missing URL above never
  // reaches here, so it doesn't burn a token.
  const rate = consumeToken(`proxy-image:${userId}`, RATE_LIMITS.proxyImage);
  if (!rate.allowed) return rateLimitedResponse(rate, "imágenes");

  let upstream: Response;
  try {
    upstream = await fetch(valid.value.url, {
      // manual: a 3xx is surfaced as a non-ok status and rejected below, so a
      // redirect to an internal host can't slip past the validated origin.
      redirect: "manual",
      headers: { accept: "image/*" },
    });
  } catch {
    return new Response("fetch_failed", { status: 502 });
  }
  if (!upstream.ok) return new Response("upstream_error", { status: 502 });

  const contentType = upstream.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) {
    return new Response("not_image", { status: 415 });
  }
  const declared = Number(upstream.headers.get("content-length") || 0);
  if (declared && declared > MAX_BYTES) {
    return new Response("too_large", { status: 413 });
  }

  const buf = await upstream.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) {
    return new Response("too_large", { status: 413 });
  }

  return new Response(buf, {
    status: 200,
    headers: {
      "content-type": contentType,
      "cache-control": "private, max-age=300",
    },
  });
}
