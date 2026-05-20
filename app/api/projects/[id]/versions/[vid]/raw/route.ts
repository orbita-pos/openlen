import { auth } from "@/auth";
import { getVersionHtml } from "@/lib/projects/versions";

export const runtime = "nodejs";

// GET /api/projects/<id>/versions/<vid>/raw — auth-gated HTML for the
// version's snapshot. Used by the VersionsPanel iframe thumbnails.
//
// Versions are immutable once written, so the response is safe to cache
// for a few minutes inside the tab — saves re-fetching the same HTML
// when the user scrolls the timeline.
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; vid: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return text("unauthorized", 401);

  const { id, vid } = await ctx.params;
  if (!id || !vid) return text("missing id", 400);

  const html = await getVersionHtml({
    projectId: id,
    versionId: vid,
    userId: session.user.id,
  });
  if (html === null) return text("not found", 404);

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, max-age=300",
      "x-frame-options": "SAMEORIGIN",
    },
  });
}

function text(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain" },
  });
}
