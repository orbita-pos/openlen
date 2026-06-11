import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import type { ProjectData } from "@/lib/projects/types";
import {
  buildPageShell,
  listSitePages,
  MAX_SITE_PAGES,
  pageTitle,
  validatePageSlug,
} from "@/lib/projects/site-pages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// GET  /api/projects/[id]/pages — list the project's extra pages.
// POST /api/projects/[id]/pages — create a page. The new page is born as a
//      copy of the HOME document so it wears the project's look/world/nav
//      immediately; the user then edits its content. No HTML is accepted
//      here — page edits flow through PATCH /html (which sanitizes).
// ─────────────────────────────────────────────────────────────────────────────

const CreateSchema = z.object({
  slug: z.string().min(1).max(60),
  title: z.string().max(120).optional(),
});

async function loadRow(projectId: string, userId: string) {
  const rows = await db
    .select({ data: schema.projects.data })
    .from(schema.projects)
    .where(
      and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  const row = await loadRow(id, session.user.id);
  if (!row) return json({ error: "not_found" }, 404);
  return json({ pages: listSitePages(row.data) }, 200);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "invalid", message: parsed.error.issues[0]?.message }, 400);
  }
  const check = validatePageSlug(parsed.data.slug);
  if (!check.ok) return json({ error: check.reason }, 400);
  const slug = check.slug;

  const row = await loadRow(id, session.user.id);
  if (!row) return json({ error: "not_found" }, 404);
  const data: ProjectData = row.data ?? { html: "" };
  if (!data.html) return json({ error: "no_home_html" }, 409);

  const pages = data.pages ?? {};
  if (pages[slug]) return json({ error: "exists" }, 409);
  if (Object.keys(pages).length >= MAX_SITE_PAGES) {
    return json({ error: "limit_reached", limit: MAX_SITE_PAGES }, 402);
  }

  const title = parsed.data.title?.trim() || undefined;
  // New pages are born as the home page's SHELL (head + nav + footer, blank
  // titled canvas) so they wear the look without dragging Home's content
  // along. If the home document doesn't parse, fall back to a full copy.
  const displayTitle = pageTitle(slug, title ? { html: "", title } : undefined);
  const pageHtml = buildPageShell(data.html, displayTitle) ?? data.html;
  const nextData: ProjectData = {
    ...data,
    pages: { ...pages, [slug]: { html: pageHtml, ...(title ? { title } : {}) } },
  };
  await db
    .update(schema.projects)
    .set({ data: nextData, updatedAt: new Date() })
    .where(
      and(eq(schema.projects.id, id), eq(schema.projects.userId, session.user.id)),
    );

  return json(
    { ok: true, page: { slug, title: pageTitle(slug, nextData.pages?.[slug]) } },
    200,
  );
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
