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
import { renderProjectThumbnail } from "@/lib/projects/thumbnail";
import type { ProjectData } from "@/lib/projects/types";
import { listTemplates } from "@/lib/templates/store";
import { pickTemplate, pickWeighted, type TemplateCatalogItem } from "@/lib/curate/pick-template";
import {
  logShadowComparisonWhenReady,
  runShadowSelection,
  safeTemplatePickerMode,
} from "@/lib/generation/shadow-selection";
import { resolveProfileForCreation } from "@/lib/business-profiles/store";
import { overlayProfile } from "@/lib/business-profiles/overlay";
import { selectGenerationRoute } from "@/lib/generation/safe-selection";
import { shouldRunLegacySafeShadow, visualEngineMode } from "@/lib/generation/visual-engine-mode";
import { fillAndNormalizeCuratedTemplate, finalizeCuratedDocument } from "@/lib/curate/build-curated-document";
import {
  calculateQuickDeliveryCredits,
  commitQuickVisualEngineDocument,
  launchShadowSkeletonCandidate,
  planQuickVisualEngineRoute,
  runSkeletonCandidate,
} from "@/lib/curate/quick-visual-engine";

// POST /api/curate — the FREE-tier page builder (CURATION).
// Body: { brief: string }
//
// SSE events:
//   progress { stage: "picking"|"loading"|"filling"|"persisting" }
//   preview  { html }
//   done     { projectId, title, templateId, filled, appliedOps, credits, durationMs }
//   error    { kind, message }

export const runtime = "nodejs";

const ENCODER = new TextEncoder();

// One curate per user at a time. Cleared in finally so a crash cannot lock out.
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

        const visualMode = visualEngineMode();
        emit("progress", { stage: "picking" });
        const templates = await listTemplates({ status: "published" });
        if (templates.length === 0) {
          emit("error", { kind: "no-templates", message: "No published templates to choose from." });
          return close();
        }
        const catalog: TemplateCatalogItem[] = templates.map((template) => ({
          id: template.id,
          name: template.name,
          family: template.family,
          mode: template.mode,
          pitch: template.pitch,
          description: template.description,
        }));

        // Weighted Quick and safe selection are independent and start together.
        const pickPromise = pickTemplate(brief, catalog);
        const safePromise = visualMode === "off"
          ? Promise.resolve(null)
          : selectGenerationRoute(brief, templates);
        const legacyShadowPromise = shouldRunLegacySafeShadow(
          visualMode,
          safeTemplatePickerMode(),
        )
          ? runShadowSelection(brief, templates)
          : Promise.resolve(null);
        const pick = await pickPromise;
        // Shadow selection/candidate work must not delay the baseline. Skeleton
        // mode awaits the safe result because it can change user-visible delivery.
        const safeResult = visualMode === "skeleton" ? await safePromise : null;
        if (!pick.ok) {
          emit("error", { kind: pick.error.kind, message: `Pick failed: ${pick.error.message}` });
          return close();
        }

        const chosenId = pickWeighted(pick.templateIds);
        void logShadowComparisonWhenReady(legacyShadowPromise, chosenId);
        const routePlan = planQuickVisualEngineRoute({
          mode: visualMode,
          weightedTemplateId: chosenId,
          safeResult,
        });

        // Resolve these once. Shadow and delivery share the same immutable values.
        const profile = await resolveProfileForCreation(userId, profileId);
        const copy = overlayProfile(pick.copy, profile.data);
        const titleFor = (templateId: string) =>
          copy.business_name?.trim()
          || templates.find((template) => template.id === templateId)?.name
          || "Untitled page";

        if (visualMode === "shadow") {
          // Safe selection and the candidate remain off the SSE critical path.
          // The candidate helper owns all errors and cannot preview or persist.
          void safePromise.then(async (shadowSafeResult) => {
            const shadowPlan = planQuickVisualEngineRoute({
              mode: "shadow",
              weightedTemplateId: chosenId,
              safeResult: shadowSafeResult,
            });
            if (!shadowPlan.shadowTemplateId || !shadowSafeResult?.ok) return;
            const shadowTemplate = templates.find(
              (template) => template.id === shadowPlan.shadowTemplateId,
            );
            if (!shadowTemplate?.visualMetadata) return;
            await launchShadowSkeletonCandidate({
              mode: "shadow",
              candidateTemplateId: shadowPlan.shadowTemplateId,
              fallbackTemplateId: chosenId,
              candidateTitle: titleFor(shadowPlan.shadowTemplateId),
              fallbackTitle: titleFor(chosenId),
              copy,
              profileData: profile.data,
              intent: shadowSafeResult.intent,
              templateMetadata: shadowTemplate.visualMetadata,
              policyVersion: shadowSafeResult.policyVersion,
            });
          }).catch(() => {
            captureException(new Error("Visual Engine shadow routing failed"), {
              route: "curate",
              stage: "visual-engine-shadow-routing",
              templateId: chosenId,
              reasonCode: "internal_error",
            });
          });
        }

        type DeliveredDocument = {
          html: string;
          templateId: string;
          title: string;
          filled: boolean;
          appliedOps: number;
          leaksBefore?: number;
          leaksAfter?: number;
          visualEngine?: NonNullable<ProjectData["generation"]>["visualEngine"];
        };
        let delivered: DeliveredDocument;
        const safeTemplate = templates.find(
          (template) => template.id === routePlan.delivery.templateId,
        );

        if (
          routePlan.delivery.kind === "template_skeleton"
          && safeResult?.ok
          && safeTemplate?.visualMetadata
        ) {
          // A skeleton never emits its raw or intermediate HTML.
          emit("progress", { stage: "loading" });
          emit("progress", { stage: "filling" });
          const skeleton = await runSkeletonCandidate({
            candidateTemplateId: routePlan.delivery.templateId,
            fallbackTemplateId: chosenId,
            candidateTitle: titleFor(routePlan.delivery.templateId),
            fallbackTitle: titleFor(chosenId),
            copy,
            profileData: profile.data,
            intent: safeResult.intent,
            templateMetadata: safeTemplate.visualMetadata,
            policyVersion: safeResult.policyVersion,
            onStage: (stage) => emit("progress", { stage }),
          });
          if (!skeleton.ok) {
            emit("error", {
              kind: skeleton.kind,
              message: skeleton.kind === "template-unavailable"
                ? "Chosen template's HTML is unavailable."
                : "Curated HTML carried editor markers — try again.",
            });
            return close();
          }
          delivered = {
            html: skeleton.html,
            templateId: skeleton.templateId,
            title: titleFor(skeleton.templateId),
            filled: skeleton.filled,
            appliedOps: skeleton.appliedOps,
            leaksBefore: skeleton.leaksBefore,
            leaksAfter: skeleton.leaksAfter,
            visualEngine: skeleton.route === "template_skeleton"
              ? skeleton.visualEngine
              : undefined,
          };
        } else {
          // Off, weighted fallbacks and full-template routes preserve current
          // Quick's immediate raw preview before filling.
          const deliveredTemplateId = routePlan.delivery.kind === "template_skeleton"
            ? chosenId
            : routePlan.delivery.templateId;
          emit("progress", { stage: "loading" });
          const built = await fillAndNormalizeCuratedTemplate({
            templateId: deliveredTemplateId,
            copy,
            onTemplateLoaded: (html) => {
              emit("preview", { html });
              emit("progress", { stage: "filling" });
            },
            onStage: (stage) => emit("progress", { stage }),
          });
          if (!built.ok) {
            emit("error", { kind: built.kind, message: "Chosen template's HTML is unavailable." });
            return close();
          }
          const finalized = finalizeCuratedDocument({
            normalizedHtml: built.normalizedHtml,
            profileData: profile.data,
            title: titleFor(deliveredTemplateId),
            brandRecolor: true,
          });
          if (!finalized.ok) {
            emit("error", { kind: finalized.kind, message: "Curated HTML carried editor markers — try again." });
            return close();
          }
          delivered = {
            html: finalized.html,
            templateId: deliveredTemplateId,
            title: titleFor(deliveredTemplateId),
            filled: built.filled,
            appliedOps: built.appliedOps,
            leaksBefore: built.leaksBefore,
            leaksAfter: built.leaksAfter,
          };
        }

        if (delivered.leaksBefore) {
          // eslint-disable-next-line no-console
          console.log(
            `[curate] copy de plantilla heredado: ${delivered.leaksBefore} bloque(s) tras el relleno, ${delivered.leaksAfter} tras el parche (plantilla ${delivered.templateId})`,
          );
        }

        const title = delivered.title;
        const cleanHtml = delivered.html;
        const projectId = crypto.randomUUID();
        try {
          await commitQuickVisualEngineDocument({
            html: cleanHtml,
            visualEngine: delivered.visualEngine,
          }, {
            emitPreview: (html) => emit("preview", { html }),
            persist: async (data) => {
              emit("progress", { stage: "persisting" });
              await db.insert(schema.projects).values({
                id: projectId,
                userId,
                title,
                brief,
                thumbnailUrl: null,
                tags: ["curated"],
                status: "draft",
                profileId: profile.id,
                logoUrl: profile.data.brand?.logoUrl ?? null,
                data,
              });
            },
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

        // Creative adaptation does not alter user credit debit.
        const credits = calculateQuickDeliveryCredits({
          pickUsage: pick.usage,
          filled: delivered.filled,
        }, creditsForUsage, AUTOFILL_CREDIT_COST);
        await debitCredits(userId, credits);

        emit("done", {
          projectId,
          title,
          templateId: delivered.templateId,
          filled: delivered.filled,
          appliedOps: delivered.appliedOps,
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

function errorJson(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
