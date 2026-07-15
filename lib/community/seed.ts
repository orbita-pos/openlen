import { db, schema } from "@/lib/db";
import type { ProjectData } from "@/lib/projects/types";
import { publishProject } from "@/lib/projects";
import { getTemplate, getTemplateHtml } from "@/lib/templates/store";
import { sanitizeForPublish } from "@/lib/html-engine";
import { normalizeBornCanonical } from "@/lib/normalize";
import { ensurePageMeta } from "@/lib/publish/ensure-page-meta";
import { transformTemplateCached } from "@/lib/transform/template-cache";
import { setVisibility } from "./store";
import { SHOWCASE, SEED_ENTRIES, type SeedEntry } from "./explore-seed.config";

/** Sanitize → born-canonical normalize → complete <head>. Same chain as
 *  from-template, minus the business-profile seeding (the showcase account has
 *  none). Returns null if the HTML carries a data-slot-path editor marker. */
export function buildShowcaseProjectData(
  title: string,
  homeHtml: string,
  pages: { slug: string; html: string }[],
): ProjectData | null {
  const s = sanitizeForPublish(homeHtml);
  if (s.html === null) return null;
  const html = ensurePageMeta(normalizeBornCanonical(s.html), { title });
  const cloned: Record<string, { html: string }> = {};
  for (const pg of pages) {
    const ps = sanitizeForPublish(pg.html);
    if (ps.html === null) continue;
    cloned[pg.slug] = {
      html: ensurePageMeta(normalizeBornCanonical(ps.html), { title }),
    };
  }
  return { html, ...(Object.keys(cloned).length ? { pages: cloned } : {}) };
}

/** Upsert the first-party showcase user by deterministic id. Idempotent. */
export async function ensureShowcaseUser(): Promise<string> {
  await db
    .insert(schema.users)
    .values({
      id: SHOWCASE.id,
      email: SHOWCASE.email,
      name: SHOWCASE.name,
      handle: SHOWCASE.handle,
      avatarUrl: SHOWCASE.avatarUrl,
      bio: SHOWCASE.bio,
      plan: "pro",
    })
    .onConflictDoUpdate({
      target: schema.users.id,
      set: {
        name: SHOWCASE.name,
        handle: SHOWCASE.handle,
        avatarUrl: SHOWCASE.avatarUrl,
        bio: SHOWCASE.bio,
      },
    });
  return SHOWCASE.id;
}

export type SeedResult = { ok: string[]; failed: { id: string; reason: string }[] };

/** Idempotent: per manifest entry, clone → publish (real subdomain, cap-exempt)
 *  → list public. Returns which project ids succeeded and which failed + why. */
export async function seedExplore(
  entries: SeedEntry[] = SEED_ENTRIES,
): Promise<SeedResult> {
  const userId = await ensureShowcaseUser();
  const ok: string[] = [];
  const failed: { id: string; reason: string }[] = [];

  for (const e of entries) {
    const tpl = await getTemplate(e.templateId);
    if (!tpl || tpl.status !== "published") {
      failed.push({ id: e.templateId, reason: "unknown_template" });
      continue;
    }
    const html = await getTemplateHtml(e.templateId);
    if (!html) {
      failed.push({ id: e.templateId, reason: "no_html" });
      continue;
    }

    // Transform de ingestión (mismas claves de cache que from-template:
    // `<id>` / `<id>--<slug>`) — sin él, los demos del Explore nacen con las
    // secciones JS-generadas VACÍAS y sin conductas. Batch admin sin usuario
    // esperando → presupuesto por-documento, no el deadline de 12s del clon.
    // Fallback interno = html original (jamás peor).
    const homeHtml = await transformTemplateCached(e.templateId, html, {
      timeoutMs: 8000,
      source: `explore-seed:${e.templateId}`,
    });
    const pages: { slug: string; html: string }[] = [];
    for (const pg of tpl.pages ?? []) {
      pages.push({
        slug: pg.slug,
        html: await transformTemplateCached(`${e.templateId}--${pg.slug}`, pg.html, {
          timeoutMs: 8000,
          source: `explore-seed:${e.templateId}--${pg.slug}`,
        }),
      });
    }

    const data = buildShowcaseProjectData(tpl.name, homeHtml, pages);
    if (!data) {
      failed.push({ id: e.templateId, reason: "invalid_html" });
      continue;
    }

    const projectId = `showcase-${e.templateId}`;
    const thumbnailUrl = tpl.thumbnailUrl ?? tpl.screenshotUrl ?? null;
    await db
      .insert(schema.projects)
      .values({
        id: projectId,
        userId,
        title: tpl.name,
        brief: `Showcase: ${tpl.name}`,
        status: "draft",
        thumbnailUrl,
        tags: [e.templateId, "showcase", tpl.family],
        data,
      })
      .onConflictDoUpdate({
        target: schema.projects.id,
        set: { data, title: tpl.name, thumbnailUrl },
      });

    try {
      await publishProject({
        projectId,
        userId,
        subdomain: e.subdomain,
        bypassSubdomainLimit: true,
        skipFlightCheck: true,
      });
    } catch (err) {
      failed.push({ id: e.templateId, reason: `publish:${(err as Error).name}` });
      continue;
    }

    const vis = await setVisibility(projectId, userId, "public");
    if (!vis.ok) {
      failed.push({ id: e.templateId, reason: `visibility:${vis.reason}` });
      continue;
    }
    ok.push(projectId);
  }

  return { ok, failed };
}
