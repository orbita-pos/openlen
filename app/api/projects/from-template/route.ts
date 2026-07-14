import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { getTemplate, getTemplateHtml } from "@/lib/templates/store";
import { createVersion } from "@/lib/projects/versions";
import { sanitizeForPublish } from "@/lib/html-engine";
import { normalizeBornCanonical } from "@/lib/normalize";
import { transformTemplateCached } from "@/lib/transform/template-cache";
import { ensurePageMeta } from "@/lib/publish/ensure-page-meta";
import { resolveProfileForCreation } from "@/lib/business-profiles/store";
import { seedBrandIntoHtml, profileMeta } from "@/lib/business-profiles/seed-html";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/from-template
// Body: { templateId: string }
//
// Clones a curated template's HTML into a NEW project owned by the caller.
// The template's HTML is stored verbatim in `project.data.html`, so the
// publish path (publishProject → publishToDir → nginx wildcard) treats it
// like any other project's output.
//
// The template itself NEVER claims a subdomain — only the project the user
// publishes does (e.g. myco.openlen.com).
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";

interface FromTemplateBody {
  templateId?: string;
  profileId?: string;
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);

  const body = (await req.json().catch(() => null)) as FromTemplateBody | null;
  if (!body || typeof body.templateId !== "string") {
    return json({ error: "invalid_body" }, 400);
  }

  const entry = await getTemplate(body.templateId);
  if (!entry || entry.status !== "published") {
    return json({ error: "unknown_template", id: body.templateId }, 404);
  }

  // Fetch the canonical HTML body from object storage. Cached at the CDN
  // edge in prod (R2); local FS read in dev.
  const html = await getTemplateHtml(entry.id);
  if (!html) {
    // eslint-disable-next-line no-console
    console.error("[from-template] failed to fetch template body", entry.id);
    return json({ error: "template_body_unavailable" }, 500);
  }

  // Transform de ingestión (lib/transform, spec 2026-07-14) — ANTES del
  // sanitize de abajo, porque necesita leer los <script> que el sanitize
  // borra: hornea el contenido que esos scripts generaban (45 plantillas del
  // catálogo publican secciones VACÍAS sin esto — medido) y traduce patrones
  // conocidos a conductas. Cacheado por sha256: corre una vez por versión de
  // plantilla, no por clon. Fallback interno = html original (jamás peor).
  // OPENLEN_TRANSFORM=0 lo apaga.
  // Presupuesto TOTAL del request (hallazgo publish-safety #3): un template
  // multi-página con cache frío lanzaba un Chrome POR PÁGINA en serie — un
  // sitio de 5 páginas podía colgar el clon ~40s. Con el deadline compartido,
  // el primer clon transforma lo que quepa en 12s y el resto queda statu quo
  // SIN cachear — cada clon siguiente avanza más hasta converger (los éxitos
  // sí se cachean).
  const transformStarted = Date.now();
  const TRANSFORM_TOTAL_BUDGET_MS = 12_000;
  const remainingBudget = () =>
    Math.max(0, TRANSFORM_TOTAL_BUDGET_MS - (Date.now() - transformStarted));

  const transformedHtml =
    remainingBudget() > 500
      ? await transformTemplateCached(entry.id, html, {
          timeoutMs: Math.min(8000, remainingBudget()),
        })
      : html;

  // Defense in depth: sanitize the curated body (strips any stray
  // scripts/handlers/iframes; clean templates pass through byte-identical) and
  // reject the data-slot-path editor marker the publish flow also rejects.
  const sanitized = sanitizeForPublish(transformedHtml);
  if (sanitized.html === null) {
    return json(
      {
        error: "invalid_template",
        message:
          "Template HTML contains data-slot-path markers — fix the curated file.",
      },
      500,
    );
  }
  const cleanHtml = sanitized.html;

  // Resolve the business first so the clone is born with the user's info. A
  // hand-picked template keeps its OWN look (recolor:false) but still gets the
  // real contact widget + brand logo/og.
  const business = await resolveProfileForCreation(
    session.user.id,
    typeof body.profileId === "string" ? body.profileId : null,
  );

  // Clone through the born-canonical normalizer (so radius / font / accent
  // become editable in the inspector) → seed the contact widget + logo/og
  // (no-op for an empty profile) → complete the <head> for SEO.
  const finalHtml = ensurePageMeta(
    seedBrandIntoHtml(normalizeBornCanonical(cleanHtml), business.data, {
      recolor: false,
    }),
    { title: entry.name, ...profileMeta(business.data) },
  );

  // Multi-page template: clone each extra page through the same born-canonical
  // chain (sanitize → normalize → ensurePageMeta) into project.data.pages, so a
  // cloned site is multi-page from birth (e.g. Home + Tienda + product fichas).
  const clonedPages: Record<string, { html: string }> = {};
  for (const pg of entry.pages ?? []) {
    // Mismo transform que la Home, clave propia por página (el hash del
    // contenido distingue versiones; el sufijo evita colisión de claves) y
    // mismo deadline compartido del request.
    const pgTransformed =
      remainingBudget() > 500
        ? await transformTemplateCached(`${entry.id}--${pg.slug}`, pg.html, {
            timeoutMs: Math.min(8000, remainingBudget()),
          })
        : pg.html;
    const ps = sanitizeForPublish(pgTransformed);
    if (ps.html === null) continue; // defensive: skip a page carrying editor markers
    clonedPages[pg.slug] = {
      html: ensurePageMeta(normalizeBornCanonical(ps.html), { title: entry.name }),
    };
  }

  const projectId = crypto.randomUUID();
  try {
    await db.insert(schema.projects).values({
      id: projectId,
      userId: session.user.id,
      title: entry.name,
      brief: `Curated template: ${entry.name}`,
      // Inherit the curated template's own rendered preview as the project's
      // initial card thumbnail — a real preview from the first second, no
      // render needed. The screenshot (full-page JPG) is the fallback if the
      // AVIF card thumbnail isn't generated yet. Refreshed to the project's
      // own bytes on first publish.
      thumbnailUrl: entry.thumbnailUrl ?? entry.screenshotUrl ?? null,
      tags: [entry.id, "template", entry.family],
      status: "draft",
      profileId: business.id,
      logoUrl: business.data.brand?.logoUrl ?? null,
      data: {
        html: finalHtml,
        ...(Object.keys(clonedPages).length ? { pages: clonedPages } : {}),
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[from-template] db insert failed", err);
    return json({ error: "db_insert_failed" }, 500);
  }

  // Seed the version history with the freshly-cloned template — gives the
  // user a "back to original" target if they chat the page into oblivion.
  await createVersion({
    projectId,
    html: finalHtml,
    label: `Initial: ${entry.name}`,
    source: "initial",
  }).catch((err: unknown) => {
    // Don't fail the create on a version-write hiccup — the project itself
    // is fine; user just won't have a v0 in their timeline.
    // eslint-disable-next-line no-console
    console.error("[from-template] initial version snapshot failed", err);
  });

  // …and a v0 for each cloned subpage, so "back to original" works per page
  // even if the user chats a subpage into oblivion before the first publish.
  for (const [slug, pg] of Object.entries(clonedPages)) {
    await createVersion({
      projectId,
      html: pg.html,
      label: `Initial: ${entry.name}`,
      source: "initial",
      page: slug,
    }).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error("[from-template] initial page version snapshot failed", slug, err);
    });
  }

  return json({ projectId, title: entry.name }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
