import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/projects/<id>/raw — auth-gated text/html of the project's current
// data.html. Used by the workspace Pages sidebar to embed live iframe
// thumbnails of the user's own projects without having to round-trip through
// the JSON GET + parse. Browser caches the response per-id so scrolling the
// project list doesn't refetch.
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return text("unauthorized", 401);

  const { id } = await ctx.params;
  if (!id) return text("missing id", 400);

  const rows = await db
    .select({ data: schema.projects.data })
    .from(schema.projects)
    .where(
      and(eq(schema.projects.id, id), eq(schema.projects.userId, session.user.id)),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return text("not found", 404);

  // Multi-page: ?page=<slug> serves that site page's document instead of
  // home — the editor's "open in new tab" for an unpublished subpage.
  const pageSlug = new URL(req.url).searchParams.get("page");
  if (pageSlug) {
    const page = row.data?.pages?.[pageSlug];
    if (!page) return text("page not found", 404);
    return new Response(page.html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "private, no-cache, must-revalidate",
        "x-frame-options": "SAMEORIGIN",
      },
    });
  }

  const html = row.data?.html ?? "";
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // We want the latest edits to show; a stale list of project
      // thumbnails defeats the purpose. Browser may cache the HTTP
      // response for a few seconds inside the same tab, but no shared
      // / CDN caching.
      "cache-control": "private, no-cache, must-revalidate",
      // Iframe is sized + transformed by the parent; the embedded
      // document itself must allow same-origin so the parent could
      // postMessage if we ever wire that back. Today the iframe is
      // pointer-events-none, but the same-origin posture is consistent
      // with TemplatePreviewFrame.
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
