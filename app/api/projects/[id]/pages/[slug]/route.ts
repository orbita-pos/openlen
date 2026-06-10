import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import type { ProjectData } from "@/lib/projects/types";
import { pageTitle, validatePageSlug } from "@/lib/projects/site-pages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// GET    /api/projects/[id]/pages/[slug] — the page's html (editor switch).
// PATCH  /api/projects/[id]/pages/[slug] — rename the page's display title.
//        (Slug renames are deliberately not supported in v1 — they'd break
//        published links; delete + recreate is the explicit path.)
// DELETE /api/projects/[id]/pages/[slug] — remove the page.
// ─────────────────────────────────────────────────────────────────────────────

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

function resolveSlug(raw: string): string | null {
  const check = validatePageSlug(raw);
  return check.ok ? check.slug : null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; slug: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id, slug: rawSlug } = await params;
  const slug = resolveSlug(rawSlug);
  if (!slug) return json({ error: "invalid" }, 400);

  const row = await loadRow(id, session.user.id);
  const page = row?.data?.pages?.[slug];
  if (!row || !page) return json({ error: "not_found" }, 404);
  return json(
    { page: { slug, title: pageTitle(slug, page), html: page.html } },
    200,
  );
}

const RenameSchema = z.object({ title: z.string().min(1).max(120) });

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; slug: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id, slug: rawSlug } = await params;
  const slug = resolveSlug(rawSlug);
  if (!slug) return json({ error: "invalid" }, 400);

  const body = await req.json().catch(() => null);
  const parsed = RenameSchema.safeParse(body);
  if (!parsed.success) return json({ error: "invalid" }, 400);

  const row = await loadRow(id, session.user.id);
  const page = row?.data?.pages?.[slug];
  if (!row || !row.data || !page) return json({ error: "not_found" }, 404);

  const nextData: ProjectData = {
    ...row.data,
    pages: {
      ...row.data.pages,
      [slug]: { ...page, title: parsed.data.title.trim() },
    },
  };
  await db
    .update(schema.projects)
    .set({ data: nextData, updatedAt: new Date() })
    .where(
      and(eq(schema.projects.id, id), eq(schema.projects.userId, session.user.id)),
    );
  return json({ ok: true }, 200);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; slug: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id, slug: rawSlug } = await params;
  const slug = resolveSlug(rawSlug);
  if (!slug) return json({ error: "invalid" }, 400);

  const row = await loadRow(id, session.user.id);
  if (!row || !row.data?.pages?.[slug]) return json({ error: "not_found" }, 404);

  const { [slug]: _removed, ...rest } = row.data.pages;
  const nextData: ProjectData = { ...row.data, pages: rest };
  await db
    .update(schema.projects)
    .set({ data: nextData, updatedAt: new Date() })
    .where(
      and(eq(schema.projects.id, id), eq(schema.projects.userId, session.user.id)),
    );
  return json({ ok: true }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
