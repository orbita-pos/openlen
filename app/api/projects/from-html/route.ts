import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { createVersion } from "@/lib/projects/versions";
import { sanitizeForPublish } from "@/lib/html-engine";
import { normalizeBornCanonical } from "@/lib/normalize";
import { ensurePageMeta } from "@/lib/publish/ensure-page-meta";
import { resolveProfileForCreation } from "@/lib/business-profiles/store";
import { renderProjectThumbnail } from "@/lib/projects/thumbnail";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/from-html
// Body: { html: string, title?: string }
//
// Accepts ANY HTML string from the client (typically pasted from a claude.ai
// artifact) and persists it as the new project's `data.html`. The Deploy
// dropdown on /new then publishes that HTML verbatim through
// `publishProject` → `publishToDir`.
//
// Safety:
// - 8 MB max HTML size.
// - sanitizeForPublish() strips inline scripts / on*-handlers / dangerous-URL
//   schemes / iframes / meta-refresh (Tailwind CDN is preserved) and rejects
//   `data-slot-path=` editor markers. We store the CLEANED html; the same gate
//   runs again in publishToDir as defense in depth.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";

const MAX_HTML_BYTES = 8 * 1024 * 1024;

interface FromHtmlBody {
  html?: string;
  title?: string;
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);

  const body = (await req.json().catch(() => null)) as FromHtmlBody | null;
  if (!body || typeof body.html !== "string" || body.html.trim().length === 0) {
    return json(
      { error: "invalid_body", message: "html string is required" },
      400,
    );
  }
  const html = body.html;
  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
    return json({ error: "too_large", message: "HTML must be under 8 MB" }, 413);
  }
  const sanitized = sanitizeForPublish(html);
  if (sanitized.html === null) {
    return json(
      {
        error: "invalid_html",
        message:
          "HTML contains editor-mode markers (data-slot-path). Save the rendered output instead.",
      },
      400,
    );
  }
  const cleanHtml = sanitized.html;

  const title =
    (typeof body.title === "string" && body.title.trim()) ||
    extractTitle(html) ||
    "Untitled page";

  // Born-canonical: pasted HTML enters on the same token contract as a
  // generated page — radius / font / accent become controllable. Then
  // complete the <head> so it's born SEO-healthy (the user pasting raw HTML
  // often has no meta description / og tags / favicon).
  const finalHtml = ensurePageMeta(normalizeBornCanonical(cleanHtml), { title });

  const business = await resolveProfileForCreation(session.user.id);
  const projectId = crypto.randomUUID();
  try {
    await db.insert(schema.projects).values({
      id: projectId,
      userId: session.user.id,
      title,
      brief: `Pasted HTML${body.title ? `: ${body.title}` : ""}`,
      thumbnailUrl: null,
      tags: ["paste"],
      status: "draft",
      profileId: business.id,
      data: { html: finalHtml },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[from-html] db insert failed", err);
    return json({ error: "db_insert_failed" }, 500);
  }

  // Seed the version history with the pasted HTML — anchor point the user
  // can restore to if subsequent chats / inline edits ruin the page.
  await createVersion({
    projectId,
    html: finalHtml,
    label: "Pasted HTML",
    source: "initial",
  }).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error("[from-html] initial version snapshot failed", err);
  });

  // Background card thumbnail so the pasted page shows a preview in /projects
  // instead of the placeholder icon. Fire-and-forget — never blocks the create.
  void renderProjectThumbnail({ projectId, html: finalHtml });

  return json({ projectId, title }, 200);
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const inner = match?.[1]?.trim();
  return inner && inner.length > 0 ? inner.slice(0, 200) : null;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
