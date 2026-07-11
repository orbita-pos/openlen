import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { getProfile } from "@/lib/business-profiles/store";
import { seedBrandIntoHtml, profileMeta } from "@/lib/business-profiles/seed-html";
import { ensurePageMeta } from "@/lib/publish/ensure-page-meta";
import { sanitizeForPublish } from "@/lib/html-engine";
import {
  getProject,
  listProjectsForProfile,
  publishProject,
} from "@/lib/projects";
import { createVersion } from "@/lib/projects/versions";
import type { ProjectData } from "@/lib/projects/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/profiles/[id]/apply — "Aplicar a mis páginas".
//
// Pushes the (just-edited) business profile back into every page linked to it:
// the same deterministic seed as /api/projects/[id]/seed-profile (contact
// widget + brand logo/og + head meta, recolor:false so designs are untouched),
// but across ALL of the profile's projects — and pages that are live get
// republished to disk so the change actually reaches visitors. This closes the
// "profile drift" gap: edit your hours/phone once, every page catches up.
//
// Sequential on purpose: publishProject re-bakes a full release (images,
// fonts, translations) and running several concurrently would spike the box.
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const userId = session.user.id;
  const { id } = await params;

  const profile = await getProfile(userId, id);
  if (!profile) return json({ error: "not_found" }, 404);

  const linked = await listProjectsForProfile(userId, id);
  let updated = 0;
  let republished = 0;
  let failed = 0;

  for (const summary of linked) {
    try {
      const project = await getProject(summary.id, userId);
      const homeHtml = project?.data?.html ?? "";
      if (!project || !homeHtml) continue;

      // Home gets the full treatment (seed + head meta), mirroring
      // seed-profile. Site pages get the seed only — ensurePageMeta with the
      // PROJECT title could stomp their page-specific titles.
      const seededHome = ensurePageMeta(
        seedBrandIntoHtml(homeHtml, profile.data, { recolor: false }),
        { title: project.title, ...profileMeta(profile.data) },
      );
      const sanitizedHome = sanitizeForPublish(seededHome);
      if (sanitizedHome.html === null) {
        failed++;
        continue;
      }

      const base: ProjectData = project.data ?? { html: "" };
      const nextPages = { ...base.pages };
      for (const [slug, row] of Object.entries(base.pages ?? {})) {
        if (!row?.html) continue;
        const sanitizedPage = sanitizeForPublish(
          seedBrandIntoHtml(row.html, profile.data, { recolor: false }),
        );
        if (sanitizedPage.html !== null) {
          nextPages[slug] = { ...row, html: sanitizedPage.html };
        }
      }

      const nextData: ProjectData = {
        ...base,
        html: sanitizedHome.html,
        ...(base.pages ? { pages: nextPages } : {}),
      };

      await db
        .update(schema.projects)
        .set({
          data: nextData,
          logoUrl: profile.data.brand?.logoUrl ?? project.logoUrl ?? null,
          updatedAt: new Date(),
        })
        .where(
          and(eq(schema.projects.id, summary.id), eq(schema.projects.userId, userId)),
        );

      await createVersion({
        projectId: summary.id,
        html: sanitizedHome.html,
        label: `Negocio aplicado: ${profile.name}`,
        source: "manual",
        page: null,
      }).catch(() => {});

      updated++;

      if (summary.subdomain) {
        try {
          await publishProject({
            projectId: summary.id,
            userId,
            subdomain: summary.subdomain,
          });
          republished++;
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("[profiles/apply] republish failed", summary.id, err);
          failed++;
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[profiles/apply] project failed", summary.id, err);
      failed++;
    }
  }

  return json({ total: linked.length, updated, republished, failed }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
