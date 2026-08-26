import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { runtimeMapDe } from "@/lib/projects/page-runtimes";
import type { FormConfig, ProjectData } from "@/lib/projects/types";
import { pageTitle, validatePageSlug } from "@/lib/projects/site-pages";
import { unpublishPageDir } from "@/lib/publish/filesystem";
import { purgeSubdomain } from "@/lib/publish/cache-purge";

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
    .select({
      data: schema.projects.data,
      subdomain: schema.projects.subdomain,
      pageRuntimes: schema.projects.pageRuntimes,
    })
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

// `membersOnly` desapareció con el módulo Miembros (2026-08-21): sin él no hay
// páginas restringidas, así que lo único que se edita aquí es el título.
const PatchSchema = z.object({
  title: z.string().min(1).max(120),
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
  nextPage.title = parsed.data.title.trim();

  const nextData: ProjectData = {
    ...row.data,
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
    { ok: true },
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

  // Clean the page's page-scoped form config ("<slug>:<index>" keys) so a
  // recreated same-slug page doesn't silently re-inherit the old notify-email
  // / redirect (wrong-recipient lead emails).
  const forms = { ...(row.data.settings?.forms ?? {}) } as Record<string, FormConfig>;
  let formsTouched = false;
  for (const key of Object.keys(forms)) {
    if (key.startsWith(`${slug}:`)) {
      delete forms[key];
      formsTouched = true;
    }
  }
  const nextSettings = formsTouched
    ? { ...row.data.settings, forms }
    : row.data.settings;

  const nextData: ProjectData = {
    ...row.data,
    pages: rest,
    ...(formsTouched ? { settings: nextSettings } : {}),
  };
  // Y SU JAVASCRIPT, por la misma razón que las dos limpiezas de al lado: una
  // página con el mismo slug no puede heredar nada de la borrada. El hash
  // normalmente no cuadraría con el documento nuevo — pero si el usuario vuelve
  // a pegar el MISMO HTML, sí cuadra, y el script resucita solo en una página
  // que él cree recién creada. Una cápsula huérfana no tiene dueño que la mire.
  const runtimesRestantes = (() => {
    const mapa = runtimeMapDe(row.pageRuntimes);
    if (!(slug in mapa)) return null;
    const { [slug]: _fuera, ...quedan } = mapa;
    return quedan;
  })();

  await db
    .update(schema.projects)
    .set({
      data: nextData,
      updatedAt: new Date(),
      ...(runtimesRestantes ? { pageRuntimes: runtimesRestantes } : {}),
    })
    .where(
      and(eq(schema.projects.id, id), eq(schema.projects.userId, session.user.id)),
    );

  // Clean the page's comments so a recreated same-slug page doesn't resurface
  // the old page's thread. (Snapshots, no FK — must be cleared explicitly.)
  await db
    .delete(schema.siteComments)
    .where(and(eq(schema.siteComments.projectId, id), eq(schema.siteComments.page, slug)))
    .catch(() => {});

  // If the project is live, de-publish the page NOW — drop it from the live
  // release on disk + purge its edge cache — so a deleted page stops serving
  // instead of lingering at <sub>/<slug>/ until the next manual Deploy.
  if (row.subdomain) {
    await unpublishPageDir(row.subdomain, slug).catch(() => {});
    await purgeSubdomain(row.subdomain, [`/${slug}`, `/${slug}/`]).catch(() => {});
  }

  return json({ ok: true }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
