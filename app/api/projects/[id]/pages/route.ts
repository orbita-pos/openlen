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
import { buildModuleSection } from "@/lib/publish/module-sections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// GET  /api/projects/[id]/pages — list the project's extra pages.
// POST /api/projects/[id]/pages — create a page. The new page is born as a
//      copy of the HOME document so it wears the project's look/world/nav
//      immediately; the user then edits its content. No HTML is accepted
//      here — page edits flow through PATCH /html (which sanitizes).
//
//      With `module` ("bookings" | "collections") the page is born as the shell
//      PLUS a designed, brand-matched module section (lib/publish/module-
//      sections) — slug/title are derived per module + page language; the
//      module's publish placeholder rides inside so the bake wires the widget.
// ─────────────────────────────────────────────────────────────────────────────

const MODULE_PAGE = z.enum(["bookings", "collections"]);

const CreateSchema = z
  .object({
    slug: z.string().min(1).max(60).optional(),
    title: z.string().max(120).optional(),
    module: MODULE_PAGE.optional(),
  })
  .refine((d) => !!d.slug || !!d.module, {
    message: "slug or module is required",
  });

// Per-module page slug + title, by page language (matches buildAutoMembersPage's
// es/en split; other locales fall back to English).
const MODULE_PAGE_META: Record<
  z.infer<typeof MODULE_PAGE>,
  { es: { slug: string; title: string }; en: { slug: string; title: string } }
> = {
  bookings: {
    es: { slug: "reservas", title: "Reservas" },
    en: { slug: "booking", title: "Booking" },
  },
  collections: {
    es: { slug: "catalogo", title: "Catálogo" },
    en: { slug: "catalog", title: "Catalog" },
  },
};

/** Inject a module section into a freshly-built page shell — before the footer,
 *  else before </body>. The shell's titled hero stays above it. */
function injectIntoShell(shell: string, section: string): string {
  if (!section) return shell;
  const footerIdx = shell.search(/<footer[\s>]/i);
  if (footerIdx !== -1) {
    return shell.slice(0, footerIdx) + section + shell.slice(footerIdx);
  }
  const bodyClose = shell.lastIndexOf("</body>");
  return bodyClose !== -1
    ? shell.slice(0, bodyClose) + section + shell.slice(bodyClose)
    : shell + section;
}

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
  const row = await loadRow(id, session.user.id);
  if (!row) return json({ error: "not_found" }, 404);
  const data: ProjectData = row.data ?? { html: "" };
  if (!data.html) return json({ error: "no_home_html" }, 409);

  // Resolve slug + title + (optional) module section. A module page derives its
  // slug/title per page language; otherwise the user-supplied slug is used.
  const isSpanish = /<html[^>]*\blang=["']?es/i.test(data.html);
  let slug: string;
  let title: string | undefined;
  let section = "";
  if (parsed.data.module) {
    const meta = MODULE_PAGE_META[parsed.data.module][isSpanish ? "es" : "en"];
    const check = validatePageSlug(meta.slug);
    if (!check.ok) return json({ error: check.reason }, 400);
    slug = check.slug;
    title = meta.title;
    section = buildModuleSection(parsed.data.module, {
      lang: isSpanish ? "es" : "en",
    });
  } else {
    const check = validatePageSlug(parsed.data.slug as string);
    if (!check.ok) return json({ error: check.reason }, 400);
    slug = check.slug;
    title = parsed.data.title?.trim() || undefined;
  }

  const pages = data.pages ?? {};
  if (pages[slug]) return json({ error: "exists", slug }, 409);
  if (Object.keys(pages).length >= MAX_SITE_PAGES) {
    return json({ error: "limit_reached", limit: MAX_SITE_PAGES }, 402);
  }

  // New pages are born as the home page's SHELL (head + nav + footer, blank
  // titled canvas) so they wear the look without dragging Home's content along.
  // A module page then gets its designed section injected before the footer.
  const displayTitle = pageTitle(slug, title ? { html: "", title } : undefined);
  let pageHtml = buildPageShell(data.html, displayTitle) ?? data.html;
  pageHtml = injectIntoShell(pageHtml, section);
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
