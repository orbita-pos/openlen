import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { validatePageSlug } from "@/lib/projects/site-pages";
import { createVersion, listVersions } from "@/lib/projects/versions";

export const runtime = "nodejs";

// GET /api/projects/<id>/versions — returns the user's version history for
// this project, newest-first, across all page scopes (the panel filters).
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);

  const { id } = await ctx.params;
  if (!id) return json({ error: "missing id" }, 400);

  const versions = await listVersions({
    projectId: id,
    userId: session.user.id,
  });
  return json({ versions }, 200);
}

const LABEL_MAX = 200;

interface PostBody {
  /** User-typed name for the checkpoint. Empty → the panel's default. */
  label?: string;
  /** Document scope: absent/null = home, slug = that site page. */
  page?: string | null;
}

// POST /api/projects/<id>/versions — "save version now": snapshot the
// project's CURRENT html (home or a site page) as a manual checkpoint.
// The content is read server-side — this route never accepts html, so it
// can't become a second (sanitize-bypassing) write path.
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);

  const { id } = await ctx.params;
  if (!id) return json({ error: "missing id" }, 400);

  const body = (await req.json().catch(() => null)) as PostBody | null;
  const rawLabel = typeof body?.label === "string" ? body.label.trim() : "";
  const label = (rawLabel || "Saved version").slice(0, LABEL_MAX);

  const rows = await db
    .select({ data: schema.projects.data })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, id),
        eq(schema.projects.userId, session.user.id),
      ),
    )
    .limit(1);
  const existing = rows[0];
  if (!existing) return json({ error: "not_found" }, 404);

  let page: string | null = null;
  let html = existing.data?.html ?? "";
  if (typeof body?.page === "string" && body.page.length > 0) {
    const check = validatePageSlug(body.page);
    const slug = check.ok ? check.slug : null;
    const pageRow = slug ? existing.data?.pages?.[slug] : undefined;
    if (!slug || !pageRow) return json({ error: "page_not_found" }, 404);
    page = slug;
    html = pageRow.html;
  }
  if (!html) return json({ error: "empty_document" }, 409);

  // relabelDedup: when the current state is already the newest snapshot,
  // honor the user's name by renaming that checkpoint instead of silently
  // doing nothing.
  const versionId = await createVersion({
    projectId: id,
    html,
    label,
    source: "manual",
    page,
    relabelDedup: true,
  });
  if (!versionId) return json({ error: "snapshot_failed" }, 500);

  return json({ ok: true, id: versionId }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
