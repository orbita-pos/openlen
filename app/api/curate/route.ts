import { captureException } from "@inariwatch/capture";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { createVersion } from "@/lib/projects/versions";
import {
  getCreditState,
  debitCredits,
  creditsForUsage,
  AUTOFILL_CREDIT_COST,
} from "@/lib/credits";
import { consumeToken, RATE_LIMITS } from "@/lib/rate-limit";
import { sanitizeForPublish } from "@/lib/html-engine";
import { normalizeBornCanonical } from "@/lib/normalize";
import { ensurePageMeta } from "@/lib/publish/ensure-page-meta";
import { renderProjectThumbnail } from "@/lib/projects/thumbnail";
import { listTemplates, getTemplateHtml } from "@/lib/templates/store";
import { pickTemplate, pickWeighted, type TemplateCatalogItem } from "@/lib/curate/pick-template";
import { fillAssembled } from "@/lib/assemble/fill";
import { getProfile } from "@/lib/business-profiles/store";
import type { ExtractedBusinessData } from "@/lib/style-match/autofill/types";
import type { BusinessProfileData } from "@/lib/business-profiles/types";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/curate — the FREE-tier page builder (CURATION).
// Body: { brief: string }
//
// brief → pick ONE whole curated template (Flash, by fit) + invent copy → fill
// the copy (Gemini) → save as a new project. A curated template is already a
// coherent, centred page, so there is NO stitching / theming / centering — the
// model CHOOSES a design rather than assembling one. Bespoke /api/generate stays
// the PAID tier (a from-scratch, novel layout).
//
// SSE events:
//   progress { stage: "picking"|"loading"|"filling"|"persisting" }
//   preview  { html }   — the chosen template (instant), then the filled page
//   done     { projectId, title, templateId, filled, appliedOps, credits, durationMs }
//   error    { kind, message }
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";

const ENCODER = new TextEncoder();

// One curate per user at a time (a model pick + a fill) — a double-click
// shouldn't fire two. Cleared in finally so a crash can't lock out.
const inFlightUsers = new Set<string>();

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return errorJson(401, "unauthenticated");
  const userId = session.user.id;

  const rate = consumeToken(`curate:${userId}`, RATE_LIMITS.autofill);
  if (!rate.allowed) {
    const retryAfterSec = Math.ceil(rate.retryAfterMs / 1000);
    return new Response(
      JSON.stringify({ error: `Rate limit excedido — máximo ${rate.limit} por hora.`, retryAfterSec }),
      { status: 429, headers: { "content-type": "application/json", "retry-after": String(retryAfterSec) } },
    );
  }

  let body: { brief?: unknown; profileId?: unknown };
  try {
    body = await req.json();
  } catch {
    return errorJson(400, "invalid JSON body");
  }
  const brief = typeof body.brief === "string" ? body.brief.trim() : "";
  if (brief.length < 10) return errorJson(400, "brief is required — describe the page in at least a sentence");
  if (brief.length > 4000) return errorJson(400, "brief too long (max 4000 characters)");
  const profileId = typeof body.profileId === "string" ? body.profileId : null;

  if (inFlightUsers.has(userId)) {
    return new Response(
      JSON.stringify({ error: "Ya hay una página armándose. Esperá a que termine." }),
      { status: 409, headers: { "content-type": "application/json" } },
    );
  }
  inFlightUsers.add(userId);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const t0 = Date.now();
      let closed = false;
      const emit = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(ENCODER.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      try {
        const { balance } = await getCreditState(userId);
        if (balance < 1) {
          emit("error", { kind: "credits", message: "Te quedaste sin créditos este mes. Esperá al reset o pasá a Pro." });
          return close();
        }

        // 1. Pick the best-fitting template + invent copy (Flash).
        emit("progress", { stage: "picking" });
        const templates = await listTemplates({ status: "published" });
        if (templates.length === 0) {
          emit("error", { kind: "no-templates", message: "No published templates to choose from." });
          return close();
        }
        const catalog: TemplateCatalogItem[] = templates.map((t) => ({
          id: t.id,
          name: t.name,
          family: t.family,
          mode: t.mode,
          pitch: t.pitch,
          description: t.description,
        }));
        const pick = await pickTemplate(brief, catalog);
        if (!pick.ok) {
          emit("error", { kind: pick.error.kind, message: `Pick failed: ${pick.error.message}` });
          return close();
        }
        // Pick one of the model's ranked candidates, biased toward #1 — so
        // re-generating the same brief gives a different (still well-fitting)
        // template instead of the same page every time.
        const chosenId = pickWeighted(pick.templateIds);
        const chosen = templates.find((t) => t.id === chosenId);

        // Seed the copy from the user's saved business profile (if one was
        // picked): real info wins, the model's invented copy fills any gaps.
        const profile = profileId ? await getProfile(userId, profileId) : null;
        const copy = profile ? overlayProfile(pick.copy, profile.data) : pick.copy;

        // 2. Load the chosen template's HTML.
        emit("progress", { stage: "loading" });
        const templateHtml = await getTemplateHtml(chosenId);
        if (templateHtml === null) {
          emit("error", { kind: "template-unavailable", message: "Chosen template's HTML is unavailable." });
          return close();
        }
        // Show the real chosen design immediately — the user watches their
        // actual page appear while the copy fills in next.
        emit("preview", { html: templateHtml });

        // 3. Fill the invented copy (Gemini); degrades to the template's own copy.
        emit("progress", { stage: "filling" });
        const fill = await fillAssembled(templateHtml, copy, {
          onStage: (stage) => emit("progress", { stage }),
        });

        // 4. Born-canonical + SEO head, same ingestion as every other project.
        const title = copy.business_name?.trim() || chosen?.name || "Untitled page";
        const finalHtml = ensurePageMeta(normalizeBornCanonical(fill.html), { title });

        // 5. Reserved-marker guard + sanitize (defense in depth, like from-html).
        const sanitized = sanitizeForPublish(finalHtml);
        if (sanitized.html === null) {
          emit("error", { kind: "editor-marker-leak", message: "Curated HTML carried editor markers — try again." });
          return close();
        }
        const cleanHtml = sanitized.html;
        // Swap the preview to the filled page so the copy visibly lands
        // before the editor hand-off.
        emit("preview", { html: cleanHtml });

        // 6. Persist as a new project.
        emit("progress", { stage: "persisting" });
        const projectId = crypto.randomUUID();
        try {
          await db.insert(schema.projects).values({
            id: projectId,
            userId,
            title,
            brief,
            thumbnailUrl: null,
            tags: ["curated"],
            status: "draft",
            profileId: profile ? profile.id : null,
            data: { html: cleanHtml },
          });
        } catch (err) {
          console.error("[curate] db insert failed", err);
          if (err instanceof Error) captureException(err, { route: "curate", stage: "db-insert", userId });
          emit("error", { kind: "db", message: "Curated successfully but failed to save — try again." });
          return close();
        }

        await createVersion({ projectId, html: cleanHtml, label: `Curated: ${title}`, source: "initial" }).catch(
          (err: unknown) => {
            console.error("[curate] initial version snapshot failed", err);
          },
        );
        void renderProjectThumbnail({ projectId, html: cleanHtml });

        // 7. Charge: metered pick (Flash) + the fill (flat, only if it ran).
        const pickCredits = pick.usage
          ? creditsForUsage(pick.usage.inputTokens, pick.usage.outputTokens, "gemini-flash")
          : 1;
        const credits = pickCredits + (fill.filled ? AUTOFILL_CREDIT_COST : 0);
        await debitCredits(userId, credits);

        emit("done", {
          projectId,
          title,
          templateId: chosenId,
          filled: fill.filled,
          appliedOps: fill.appliedOps,
          credits,
          durationMs: Date.now() - t0,
        });
        close();
      } catch (err) {
        console.error("[curate] stream failed", err);
        if (err instanceof Error) captureException(err, { route: "curate", stage: "stream", userId });
        emit("error", { kind: "unhandled", message: err instanceof Error ? err.message : "Unknown error" });
        close();
      } finally {
        inFlightUsers.delete(userId);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

// Overlay the user's saved profile onto the model's invented copy: real values
// win where present; the invented copy fills any gaps (a profile only SEEDS).
function overlayProfile(
  copy: ExtractedBusinessData,
  data: BusinessProfileData,
): ExtractedBusinessData {
  const out: ExtractedBusinessData = { ...copy };
  const real = (v: string | null | undefined) =>
    typeof v === "string" && v.trim().length > 0;
  if (real(data.business_name)) out.business_name = data.business_name;
  if (real(data.industry)) out.industry = data.industry;
  if (real(data.tagline_es)) out.tagline_es = data.tagline_es;
  if (real(data.tagline_en)) out.tagline_en = data.tagline_en;
  if (real(data.pitch)) out.pitch = data.pitch;
  if (real(data.hero_keyword)) out.hero_keyword = data.hero_keyword;
  if (real(data.cta_primary)) out.cta_primary = data.cta_primary;
  if (real(data.cta_secondary)) out.cta_secondary = data.cta_secondary;
  if (data.features?.length) out.features = data.features;
  if (data.pricing?.length) out.pricing = data.pricing;
  if (data.testimonials?.length) out.testimonials = data.testimonials;
  if (data.faq_questions?.length) out.faq_questions = data.faq_questions;
  if (data.contact) out.contact = data.contact;
  return out;
}

function errorJson(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
