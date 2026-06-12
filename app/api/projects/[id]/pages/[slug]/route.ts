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

const PatchSchema = z
  .object({
    title: z.string().min(1).max(120).optional(),
    membersOnly: z.boolean().optional(),
  })
  .refine((o) => o.title !== undefined || o.membersOnly !== undefined, {
    message: "expected title and/or membersOnly",
  });

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
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return json({ error: "invalid" }, 400);

  const row = await loadRow(id, session.user.id);
  const page = row?.data?.pages?.[slug];
  if (!row || !row.data || !page) return json({ error: "not_found" }, 404);

  const nextPage = { ...page };
  if (parsed.data.title !== undefined) {
    nextPage.title = parsed.data.title.trim();
  }
  if (parsed.data.membersOnly !== undefined) {
    if (parsed.data.membersOnly) nextPage.membersOnly = true;
    else delete nextPage.membersOnly;
  }

  // Flipping a page to members-only auto-enables the module in the same
  // read-modify-write — atomic, so the flag can never land "armed" with the
  // master switch off by accident. The UI toasts off membersAutoEnabled.
  let settings = row.data.settings;
  let membersAutoEnabled = false;
  if (parsed.data.membersOnly === true && settings?.members?.enabled !== true) {
    settings = {
      ...settings,
      members: { enabled: true, mode: settings?.members?.mode ?? "open" },
    };
    membersAutoEnabled = true;
  }

  const nextData: ProjectData = {
    ...row.data,
    ...(settings !== row.data.settings ? { settings } : {}),
    pages: {
      ...row.data.pages,
      [slug]: nextPage,
    },
  };
  await db
    .update(schema.projects)
    .set({ data: nextData, updatedAt: new Date() })
    .where(
      and(eq(schema.projects.id, id), eq(schema.projects.userId, session.user.id)),
    );
  return json(
    membersAutoEnabled ? { ok: true, membersAutoEnabled: true } : { ok: true },
    200,
  );
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
