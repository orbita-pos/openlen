import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { getProject } from "@/lib/projects";
import { createVersion } from "@/lib/projects/versions";
import { resolveProfileForCreation } from "@/lib/business-profiles/store";
import { seedBrandIntoHtml, profileMeta } from "@/lib/business-profiles/seed-html";
import { ensurePageMeta } from "@/lib/publish/ensure-page-meta";
import { sanitizeForPublish } from "@/lib/html-engine";

export const runtime = "nodejs";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/[id]/seed-profile — the editor's "Hazla tuya" action.
//
// Re-apply the user's (now-saved) business profile to an EXISTING page: surface
// the real contact widget + brand logo/og. The page KEEPS its design — we pass
// recolor:false, so this never re-themes a page the user is already looking at;
// it only adds their real info. Idempotent (seedBrandIntoHtml strips any prior
// seed first). Returns the new HTML so the editor swaps it in live.
//
// NOTE: this is a deterministic seed, NOT a copy rewrite — it can't change
// invented headline copy on free-form HTML (no op-ids). Its job is "their real
// WhatsApp / contact / logo now show up", which is the high-value part.
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const userId = session.user.id;
  const { id } = await params;

  const project = await getProject(id, userId);
  if (!project) return json({ error: "not_found" }, 404);

  const html = project.data?.html ?? "";
  if (!html) return json({ error: "empty_project" }, 400);

  // Seed from the page's own business (or the default if it has none).
  const profile = await resolveProfileForCreation(userId, project.profileId);
  const seeded = ensurePageMeta(
    seedBrandIntoHtml(html, profile.data, { recolor: false }),
    { title: project.title, ...profileMeta(profile.data) },
  );

  // Defense in depth — reject the editor marker, strip stray scripts.
  const sanitized = sanitizeForPublish(seeded);
  if (sanitized.html === null) return json({ error: "invalid_html" }, 400);
  const finalHtml = sanitized.html;

  try {
    await db
      .update(schema.projects)
      .set({
        data: { ...project.data, html: finalHtml },
        profileId: profile.id,
        logoUrl: profile.data.brand?.logoUrl ?? project.logoUrl ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.projects.id, id), eq(schema.projects.userId, userId)));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[seed-profile] db update failed", err);
    return json({ error: "db" }, 500);
  }

  await createVersion({
    projectId: id,
    html: finalHtml,
    label: `Negocio aplicado: ${profile.name}`,
    source: "manual",
  }).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error("[seed-profile] version snapshot failed", err);
  });

  return json({ html: finalHtml }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
