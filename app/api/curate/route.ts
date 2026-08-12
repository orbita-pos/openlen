import { captureException } from "@inariwatch/capture";

import { auth } from "@/auth";
import { resolveProfileForCreation } from "@/lib/business-profiles/store";
import {
  AUTOFILL_CREDIT_COST,
  creditsForUsage,
  debitCredits,
  getCreditState,
} from "@/lib/credits";
import { calculateAiCreationCredits } from "@/lib/curate/ai-creation-credits";
import type { AiCreationReasonCode, AiCreationStage } from "@/lib/curate/ai-creation-contracts";
import { aiCreationMode } from "@/lib/curate/ai-creation-mode";
import { commitAiCompositionDocument } from "@/lib/curate/commit-ai-composition";
import { runAiCreation } from "@/lib/curate/run-ai-creation";
import { db, schema } from "@/lib/db";
import { assetPipelineMode } from "@/lib/generation/asset-pipeline-mode";
import { renderProjectThumbnail } from "@/lib/projects/thumbnail";
import { createVersion } from "@/lib/projects/versions";
import { consumeToken, RATE_LIMITS } from "@/lib/rate-limit";

// POST /api/curate — hybrid-only AI page creation.
// Body: { brief: string, profileId?: string }
//
// SSE events:
//   progress { stage }
//   preview  { html } — emitted once, after the final document is persisted
//   done     { projectId, route: "section_composition", templateId: null, ... }
//   error    { kind, message }

export const runtime = "nodejs";

const ENCODER = new TextEncoder();
const AI_FAILURE_MESSAGE = "No pudimos construir una página coherente. Reintentar.";
const PROGRESS_STAGE: Record<AiCreationStage, string> = {
  intent: "analyzing",
  copy: "writing",
  sections: "planning",
  composition: "assembling",
  delivery_gate: "styling",
  visual_quality: "reviewing",
};

// One curate per user at a time. Cleared in finally so a crash cannot lock out.
const inFlightUsers = new Set<string>();

function captureFailure(stage: string, reasonCode: string): void {
  captureException(new Error("AI creation failed"), {
    route: "curate",
    stage,
    reasonCode,
  });
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return errorJson(401, "unauthenticated");
  const userId = session.user.id;

  const rate = consumeToken(`curate:${userId}`, RATE_LIMITS.autofill);
  if (!rate.allowed) {
    const retryAfterSec = Math.ceil(rate.retryAfterMs / 1000);
    return new Response(
      JSON.stringify({ error: `Rate limit excedido — máximo ${rate.limit} por hora.`, retryAfterSec }),
      {
        status: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": String(retryAfterSec),
        },
      },
    );
  }

  let body: { brief?: unknown; profileId?: unknown };
  try {
    body = await req.json();
  } catch {
    return errorJson(400, "invalid JSON body");
  }
  const brief = typeof body.brief === "string" ? body.brief.trim() : "";
  if (brief.length < 10) {
    return errorJson(400, "brief is required — describe the page in at least a sentence");
  }
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
          // The client already closed the stream.
        }
      };
      const fail = (reasonCode: string) => {
        emit("error", { kind: reasonCode, message: AI_FAILURE_MESSAGE });
        close();
      };

      try {
        const { balance } = await getCreditState(userId);
        if (balance < 1) {
          emit("error", {
            kind: "credits",
            message: "Te quedaste sin créditos este mes. Esperá al reset o pasá a Pro.",
          });
          return close();
        }

        if (aiCreationMode() !== "enabled") {
          return fail("creation_disabled");
        }

        const projectId = crypto.randomUUID();
        const profile = await resolveProfileForCreation(userId, profileId);
        const result = await runAiCreation({
          projectId,
          brief,
          profileData: profile.data,
          assetMode: assetPipelineMode(),
          onStage: (stage) => {
            const progress = PROGRESS_STAGE[stage as AiCreationStage];
            if (progress) emit("progress", { stage: progress });
          },
        });

        if (!result.ok) {
          captureFailure(result.stage, result.reasonCode);
          return fail(result.reasonCode);
        }

        try {
          await commitAiCompositionDocument({
            html: result.html,
            visualEngine: result.visualEngine,
          }, {
            emitPreview: (html) => emit("preview", { html }),
            persist: async (data) => {
              emit("progress", { stage: "persisting" });
              await db.insert(schema.projects).values({
                id: projectId,
                userId,
                title: result.title,
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
        } catch {
          captureFailure("persistence", "persistence_failed");
          return fail("persistence_failed");
        }

        const credits = calculateAiCreationCredits({
          ...(result.copyUsage ? { copyUsage: result.copyUsage } : {}),
          ...(result.generatedSectionUsage ? { generatedSectionUsage: result.generatedSectionUsage } : {}),
          filled: result.filled,
        }, creditsForUsage, AUTOFILL_CREDIT_COST);
        try {
          await debitCredits(userId, credits);
        } catch {
          captureFailure("debit", "persistence_failed");
          return fail("persistence_failed");
        }

        await createVersion({
          projectId,
          html: result.html,
          label: `Curated: ${result.title}`,
          source: "initial",
        }).catch(() => undefined);
        void renderProjectThumbnail({ projectId, html: result.html }).catch(() => undefined);

        emit("done", {
          projectId,
          title: result.title,
          route: result.route,
          templateId: result.templateId,
          filled: result.filled,
          appliedOps: result.appliedOps,
          credits,
          durationMs: Date.now() - t0,
        });
        close();
      } catch {
        const reasonCode: AiCreationReasonCode = "composition_failed";
        captureFailure("composition", reasonCode);
        fail(reasonCode);
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
