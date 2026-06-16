// POST /api/projects/[id]/apply-template — "convert my page into this template".
// Pours the project page's current content into a chosen template's design via
// fillTemplateFromPage (Opción 1: design-identical + autofill). Saves in-place,
// snapshots a version (so it's undoable), and debits credits — only on success.
// Mirrors the existing autofill route's credit/version conventions (flat
// AUTOFILL_CREDIT_COST, source "style-match" — same lib/style-match/autofill family).

import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { getProject } from "@/lib/projects";
import type { ProjectData } from "@/lib/projects/types";
import { createVersion } from "@/lib/projects/versions";
import { getCreditState, debitCredits, AUTOFILL_CREDIT_COST } from "@/lib/credits";
import { sanitizeForPublish } from "@/lib/html-engine";
import { normalizeBornCanonical } from "@/lib/normalize";
import { ensurePageMeta } from "@/lib/publish/ensure-page-meta";
import { getTemplateHtml } from "@/lib/templates/store";
import { fillTemplateFromPage } from "@/lib/style-match/autofill/fill-from-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Body {
  templateId?: string;
  page?: string;
  currentHtml?: string;
}

const isFullDoc = (s: string) => /<html[\s>]/i.test(s) && /<\/html>/i.test(s);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const userId = session.user.id;
  const { id } = await params;

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return json({ error: "invalid_body" }, 400);
  const templateId = typeof body.templateId === "string" ? body.templateId.trim() : "";
  if (!templateId) return json({ error: "templateId is required" }, 400);
  const pageSlugRaw = typeof body.page === "string" ? body.page.trim() : "";

  const project = await getProject(id, userId);
  if (!project) return json({ error: "not_found" }, 404);

  // Resolve which document we're restyling (null = home, slug = a site page).
  const pageSlug = pageSlugRaw && project.data.pages?.[pageSlugRaw] ? pageSlugRaw : null;
  if (pageSlugRaw && !pageSlug) return json({ error: "page_not_found" }, 404);

  const storedHtml = pageSlug ? project.data.pages![pageSlug].html : project.data.html;
  // Prefer the live editor HTML (may carry unsaved edits) when it's a full doc.
  const sourceHtml =
    typeof body.currentHtml === "string" && isFullDoc(body.currentHtml)
      ? body.currentHtml
      : storedHtml;
  if (!isFullDoc(sourceHtml)) return json({ error: "page has no HTML document" }, 400);

  const templateHtml = await getTemplateHtml(templateId);
  if (!templateHtml) return json({ error: "template_not_found" }, 404);

  // Credit gate — charge only after the fill succeeds (matches autofill route).
  const { balance } = await getCreditState(userId);
  if (balance < 1) return json({ error: "insufficient_credits", balance }, 402);

  const res = await fillTemplateFromPage({
    templateHtml,
    sourcePageHtml: sourceHtml,
    signal: req.signal,
  });
  if (!res.ok || !res.html) {
    // No charge on failure (Gemini error / no usable ops after retry).
    return json({ error: "restyle_failed", detail: res.error }, 502);
  }

  // Publish-safety (defense in depth): reject editor markers, then born-canonical + meta.
  const sanitized = sanitizeForPublish(res.html);
  if (sanitized.html === null) return json({ error: "editor_markers" }, 422);
  const finalHtml = ensurePageMeta(normalizeBornCanonical(sanitized.html));

  const now = new Date();
  const base: ProjectData = project.data ?? { html: "" };
  const nextData: ProjectData = pageSlug
    ? { ...base, pages: { ...base.pages, [pageSlug]: { ...base.pages?.[pageSlug], html: finalHtml } } }
    : { ...base, html: finalHtml };

  // Snapshot the pre-restyle state so the user can undo (page-scoped).
  if (storedHtml && storedHtml !== finalHtml) {
    await createVersion({
      projectId: id,
      html: storedHtml,
      label: "Before template restyle",
      source: "style-match",
      page: pageSlug,
    }).catch((err: unknown) => console.error("[apply-template] pre snapshot failed", err));
  }

  await db
    .update(schema.projects)
    .set({ data: nextData, updatedAt: now })
    .where(and(eq(schema.projects.id, id), eq(schema.projects.userId, userId)));

  await createVersion({
    projectId: id,
    html: finalHtml,
    label: `Restyled with "${templateId}"`,
    source: "style-match",
    page: pageSlug,
  }).catch((err: unknown) => console.error("[apply-template] post snapshot failed", err));

  await debitCredits(userId, AUTOFILL_CREDIT_COST);
  console.log(
    `[apply-template] ${templateId} → ${id}${pageSlug ? `/${pageSlug}` : ""} · ${res.appliedOps} ops · ${AUTOFILL_CREDIT_COST} cr`,
  );

  return json(
    { html: finalHtml, updatedAt: now.toISOString(), appliedOps: res.appliedOps, credits: AUTOFILL_CREDIT_COST },
    200,
  );
}
