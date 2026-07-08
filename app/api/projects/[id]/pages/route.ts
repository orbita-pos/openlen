import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { createSitePage } from "@/lib/projects/create-page";
import type { ProjectData } from "@/lib/projects/types";
import { listSitePages } from "@/lib/projects/site-pages";

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
//
//      Validation + slug resolution + shell/section building live in
//      lib/projects/create-page.ts (shared with the agent's crear_pagina
//      tool) — this handler is just auth -> Zod parse -> load -> createSitePage
//      -> map its error to the SAME status/payload this route has always
//      returned -> write.
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

  const outcome = createSitePage(data, parsed.data);
  if ("error" in outcome) {
    switch (outcome.error) {
      case "no_home":
        return json({ error: "no_home_html" }, 409);
      case "invalid_slug":
        return json({ error: outcome.reason }, 400);
      case "exists":
        return json({ error: "exists", slug: outcome.slug }, 409);
      case "limit_reached":
        return json({ error: "limit_reached", limit: outcome.limit }, 402);
      case "invalid_input":
        // Unreachable in practice — CreateSchema above already validated an
        // equivalent shape. Kept as a safety net, same envelope as the Zod
        // parse failure above.
        return json({ error: "invalid", message: outcome.message }, 400);
    }
  }

  await db
    .update(schema.projects)
    .set({ data: outcome.nextData, updatedAt: new Date() })
    .where(
      and(eq(schema.projects.id, id), eq(schema.projects.userId, session.user.id)),
    );

  return json({ ok: true, page: { slug: outcome.slug, title: outcome.title } }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
