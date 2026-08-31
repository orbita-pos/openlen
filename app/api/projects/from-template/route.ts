import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { getTemplate, getTemplateHtml } from "@/lib/templates/store";
import { createVersion } from "@/lib/projects/versions";
import { sanitizeForPublish } from "@/lib/html-engine";
import { passHtmlGate } from "@/lib/html-gate/document-gate";
import { collectDegradations, hadScript } from "@/lib/ingestion/degradations";
import { transformTemplateCached } from "@/lib/transform/template-cache";
import { pageMetaFor } from "@/lib/publish/page-meta-intent";

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

  // Captured once: `remainingBudget()` moves, and the record has to say what
  // actually happened, not what a second call would say.
  const homeTransformSkipped = remainingBudget() <= 500;
  const transformedHtml = homeTransformSkipped
    ? html
    : await transformTemplateCached(entry.id, html, {
        timeoutMs: Math.min(8000, remainingBudget()),
      });

  // Defense in depth: sanitize the curated body (strips any stray
  // scripts/handlers/iframes; clean templates pass through byte-identical) and
  // reject the data-slot-path editor marker the publish flow also rejects.
  // ⚰️ Aquí se resolvía el PERFIL DE NEGOCIO al crear (`resolveProfileForCreation`)
  // para que la página naciera con los datos del dueño. Retirado el 2026-08-31.
  // Los datos viven en la página; el logo se pone desde el inspector, que es
  // donde el dueño lo ve.

  // One gate. `behaviors: "warn"` — this surface FAILS OPEN: the project does
  // not exist yet, so refusing costs the user the whole page rather than an
  // edit. `seal: false` (publishToDir seals at publish time), `render: false`
  // (a clone cannot pay a browser launch). Seeding rides in `beforeMeta`.
  const gated = await passHtmlGate(
    transformedHtml,
    {
      sanitize: sanitizeForPublish,
      // ⚰️ Aquí se sembraba el perfil de negocio (`seedBrandIntoHtml`).
      // Retirado el 2026-08-31: los datos del dueño viven en su página, no en
      // otra tabla que los repinta. Con el widget de contacto ya fuera, lo
      // único que quedaba era el acento de marca — y el color de una página lo
      // decide el modelo o el inspector, que es donde el dueño lo ve.
    },
    {
      render: false,
      seal: false,
      behaviors: "warn",
      // CLONED: the curated body's <title>/og copy is OUR marketing, not this
      // user's. Preserving it published another product's name into their tab,
      // their Google result and their WhatsApp card.
      meta: pageMetaFor({ provenance: "cloned", title: entry.name }),
    },
  );
  if (!gated.ok) {
    // A curated template that cannot pass the gate is OUR broken file, not the
    // user's input — 500 and name it, exactly as before.
    return json(
      {
        error: "invalid_template",
        message:
          gated.code === "reserved_marker"
            ? "Template HTML contains data-slot-path markers — fix the curated file."
            : "Template HTML could not be cleaned — fix the curated file.",
      },
      500,
    );
  }
  const finalHtml = gated.html;

  const degradations = collectDegradations({
    surface: "from-template",
    removed: gated.removed,
    behaviorIssues: gated.issues,
    // The shared 12s deadline can run out before the home is transformed —
    // its JS-built sections then clone empty. Degradation #4: real loss, and
    // the user has no way to see why, so it goes on the record.
    transformFallback: homeTransformSkipped ? "budget" : undefined,
    hadScripts: hadScript(html),
  });

  // Multi-page template: clone each extra page through the same born-canonical
  // chain (sanitize → normalize → ensurePageMeta) into project.data.pages, so a
  // cloned site is multi-page from birth (e.g. Home + Tienda + product fichas).
  const clonedPages: Record<string, { html: string }> = {};
  for (const pg of entry.pages ?? []) {
    // Mismo transform que la Home, clave propia por página (el hash del
    // contenido distingue versiones; el sufijo evita colisión de claves) y
    // mismo deadline compartido del request.
    const pgTransformSkipped = remainingBudget() <= 500;
    const pgTransformed = pgTransformSkipped
      ? pg.html
      : await transformTemplateCached(`${entry.id}--${pg.slug}`, pg.html, {
          timeoutMs: Math.min(8000, remainingBudget()),
        });
    // Degradation #6. This used to `continue` — the subpage vanished, the
    // clone shipped, and the nav still promised a page that no longer
    // existed. Because a broken link serves the HOME page
    // ([[caddy-broken-links-serve-home]]) the user had no way to discover it:
    // the site LOOKED complete and lied about itself. A page we cannot clean
    // is our broken curated file, so it fails the whole clone loudly, the
    // same way the home page already does above.
    const pgGated = await passHtmlGate(
      pgTransformed,
      { sanitize: sanitizeForPublish },
      {
        render: false,
        seal: false,
        behaviors: "warn",
        // AUTHORED, deliberately — not because a human wrote a subpage's head,
        // but because the takeover is all-or-nothing (`takeover =
        // replaceStaleMeta && title`) and the only title in hand is the
        // project's. Taking over here would rename "Tienda" and every other
        // subpage to the template's name, flattening the page-specific titles
        // that make a multi-page site navigable.
        //
        // The title still travels: non-destructive means it is used ONLY when
        // the subpage carries none of its own, which is exactly what a fallback
        // is for.
        meta: pageMetaFor({ provenance: "authored", title: entry.name }),
      },
    );
    if (!pgGated.ok) {
      return json(
        {
          error: "invalid_template",
          message: `Template subpage "${pg.slug}" could not be cleaned — fix the curated file.`,
        },
        500,
      );
    }
    clonedPages[pg.slug] = { html: pgGated.html };
    degradations.push(
      ...collectDegradations({
        surface: "from-template",
        removed: pgGated.removed,
        behaviorIssues: pgGated.issues,
        // Degradation #5 — same deadline, per subpage.
        transformFallback: pgTransformSkipped ? "budget" : undefined,
        hadScripts: hadScript(pg.html),
      }),
    );
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
      data: {
        html: finalHtml,
        ...(Object.keys(clonedPages).length ? { pages: clonedPages } : {}),
        ...(degradations.length > 0 ? { degradations } : {}),
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
