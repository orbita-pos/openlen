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
import { buildRecipe } from "@/lib/assemble/recipe";
import { selectVariants } from "@/lib/sections/select";
import { stitchSections } from "@/lib/sections/assemble";
import { fillAssembled } from "@/lib/assemble/fill";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/assemble  — the FREE-tier page assembler.
// Body: { brief: string }
//
// brief → recipe (Flash: theme + section list + invented copy) → select coherent
// variants → stitch (server, deterministic bind, no AI) → fill copy (Kimi,
// degrades gracefully) → born-canonical + SEO head → save as a new project.
// Coherence is by construction (one stamped theme, every section bound to it),
// not by AI recolour — so the only model calls are the recipe + the copy fill.
//
// Bespoke /api/generate stays the PAID tier (full-document from scratch).
//
// SSE events:
//   progress { stage: "recipe"|"selecting"|"stitching"|"filling"|"persisting" }
//   done     { projectId, title, sections, filled, appliedOps, credits, durationMs }
//   error    { kind, message }
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";

const ENCODER = new TextEncoder();

// One assemble per user at a time — assembly is expensive (2 model calls); a
// double-click shouldn't fire two. Cleared in finally so a crash can't lock out.
const inFlightUsers = new Set<string>();

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return errorJson(401, "unauthenticated");
  const userId = session.user.id;

  const rate = consumeToken(`assemble:${userId}`, RATE_LIMITS.autofill);
  if (!rate.allowed) {
    const retryAfterSec = Math.ceil(rate.retryAfterMs / 1000);
    return new Response(
      JSON.stringify({ error: `Rate limit excedido — máximo ${rate.limit} por hora.`, retryAfterSec }),
      { status: 429, headers: { "content-type": "application/json", "retry-after": String(retryAfterSec) } },
    );
  }

  let body: { brief?: unknown };
  try {
    body = await req.json();
  } catch {
    return errorJson(400, "invalid JSON body");
  }
  const brief = typeof body.brief === "string" ? body.brief.trim() : "";
  if (brief.length < 10) return errorJson(400, "brief is required — describe the page in at least a sentence");
  if (brief.length > 4000) return errorJson(400, "brief too long (max 4000 characters)");

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

        // 1. Recipe — theme + section list + invented brief copy (Flash).
        emit("progress", { stage: "recipe" });
        const recipe = await buildRecipe(brief);
        if (!recipe.ok) {
          emit("error", { kind: recipe.error.kind, message: `Recipe failed: ${recipe.error.message}` });
          return close();
        }

        // 2. Resolve coherent variants for any types the recipe left open.
        emit("progress", { stage: "selecting" });
        const picks = await selectVariants(recipe.sections, recipe.theme);
        if (picks.length < 2) {
          emit("error", { kind: "no-sections", message: "Couldn't assemble enough sections for this brief." });
          return close();
        }

        // 3. Stitch + deterministic theme bind (no AI, no recolour calls).
        emit("progress", { stage: "stitching" });
        const stitched = await stitchSections(picks, recipe.theme);

        // 4. Fill the invented copy (Kimi); degrades to the coherent unfilled page.
        emit("progress", { stage: "filling" });
        const fill = await fillAssembled(stitched, recipe.copy, {
          onStage: (stage) => emit("progress", { stage }),
        });

        // 5. Born-canonical + SEO head, same ingestion as every other project.
        const title = recipe.copy.business_name?.trim() || "Untitled page";
        // Stitched from library sections, so the <head> can carry a section's
        // own demo metadata — same takeover as the curate path.
        const finalHtml = ensurePageMeta(normalizeBornCanonical(fill.html), {
          title,
          replaceStaleMeta: true,
        });

        // 6. Reserved-marker guard + sanitize (defense in depth, like from-html).
        const sanitized = sanitizeForPublish(finalHtml);
        if (sanitized.html === null) {
          emit("error", { kind: "editor-marker-leak", message: "Assembled HTML carried editor markers — try again." });
          return close();
        }
        const cleanHtml = sanitized.html;

        // 7. Persist as a new project.
        emit("progress", { stage: "persisting" });
        const projectId = crypto.randomUUID();
        try {
          await db.insert(schema.projects).values({
            id: projectId,
            userId,
            title,
            brief,
            thumbnailUrl: null,
            tags: ["assembled"],
            status: "draft",
            data: { html: cleanHtml },
          });
        } catch (err) {
          console.error("[assemble] db insert failed", err);
          if (err instanceof Error) captureException(err, { route: "assemble", stage: "db-insert", userId });
          emit("error", { kind: "db", message: "Assembled successfully but failed to save — try again." });
          return close();
        }

        await createVersion({ projectId, html: cleanHtml, label: `Assembled: ${title}`, source: "initial" }).catch(
          (err: unknown) => {
            console.error("[assemble] initial version snapshot failed", err);
          },
        );
        void renderProjectThumbnail({ projectId, html: cleanHtml });

        // 8. Charge: metered recipe (Flash) + the fill (flat, only if it ran).
        const recipeCredits = recipe.usage
          ? creditsForUsage(recipe.usage.inputTokens, recipe.usage.outputTokens, "gemini-flash")
          : 1;
        const credits = recipeCredits + (fill.filled ? AUTOFILL_CREDIT_COST : 0);
        await debitCredits(userId, credits);

        emit("done", {
          projectId,
          title,
          sections: picks.map((p) => p.slug),
          filled: fill.filled,
          appliedOps: fill.appliedOps,
          credits,
          durationMs: Date.now() - t0,
        });
        close();
      } catch (err) {
        console.error("[assemble] stream failed", err);
        if (err instanceof Error) captureException(err, { route: "assemble", stage: "stream", userId });
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

function errorJson(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
