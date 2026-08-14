import { captureException } from "@inariwatch/capture";

import { auth } from "@/auth";
import { resolveProfileForCreation } from "@/lib/business-profiles/store";
import {
  AUTOFILL_CREDIT_COST,
  creditsForUsage,
  getCreditState,
} from "@/lib/credits";
import { commitCurateProjectAndDebit, type AtomicCurateCommitInput } from "@/lib/curate/atomic-curate-commit";
import { calculateAiCreationCredits } from "@/lib/curate/ai-creation-credits";
import type { AiCreationReasonCode, AiCreationStage } from "@/lib/curate/ai-creation-contracts";
import { aiCreationMode } from "@/lib/curate/ai-creation-mode";
import { isUserInAiCreationRollout } from "@/lib/curate/ai-creation-rollout";
import { commitAiCompositionDocument } from "@/lib/curate/commit-ai-composition";
import { runAiCreation, type RunAiCreationDeps } from "@/lib/curate/run-ai-creation";
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

const ENCODER = new TextEncoder();
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
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

export interface CuratePostRuntimeOptions {
  /** External model/render/storage adapters only; production uses defaults. */
  readonly runAiCreationDeps?: RunAiCreationDeps;
  /** Durable database boundary; production is one writable PostgreSQL CTE. */
  readonly commitProjectAndDebit?: (input: AtomicCurateCommitInput) => Promise<void>;
  /** Test seam; production keeps proxy/browser SSE connections alive every 15s. */
  readonly heartbeatIntervalMs?: number;
}

export function createCuratePost(options: CuratePostRuntimeOptions = {}) {
return async function curatePost(req: Request): Promise<Response> {
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
      const heartbeatIntervalMs = Number.isFinite(options.heartbeatIntervalMs) && Number(options.heartbeatIntervalMs) > 0
        ? Math.floor(Number(options.heartbeatIntervalMs))
        : DEFAULT_HEARTBEAT_INTERVAL_MS;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
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
        if (heartbeat !== undefined) clearInterval(heartbeat);
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
      heartbeat = setInterval(() => emit("heartbeat", { elapsedMs: Date.now() - t0 }), heartbeatIntervalMs);
      heartbeat.unref?.();

      try {
        if (aiCreationMode() !== "enabled" || !isUserInAiCreationRollout(userId)) {
          return fail("creation_disabled");
        }

        const { balance } = await getCreditState(userId);
        if (balance < 1) {
          emit("error", {
            kind: "credits",
            message: "Te quedaste sin créditos este mes. Esperá al reset o pasá a Pro.",
          });
          return close();
        }

        const projectId = crypto.randomUUID();
        const profile = await resolveProfileForCreation(userId, profileId);
        const aiCreationInput = {
          projectId,
          brief,
          profileData: profile.data,
          assetMode: assetPipelineMode(),
          onStage: (stage: string) => {
            const progress = PROGRESS_STAGE[stage as AiCreationStage];
            if (progress) emit("progress", { stage: progress });
          },
        };
        const result = options.runAiCreationDeps
          ? await runAiCreation(aiCreationInput, options.runAiCreationDeps)
          : await runAiCreation(aiCreationInput);

        if (!result.ok) {
          captureFailure(result.stage, result.reasonCode);
          return fail(result.reasonCode);
        }

        let committedPreview: string | null = null;
        let credits = 0;
        try {
          credits = calculateAiCreationCredits({
            ...(result.copyUsage ? { copyUsage: result.copyUsage } : {}),
            ...(result.generatedSectionUsage ? { generatedSectionUsage: result.generatedSectionUsage } : {}),
            filled: result.filled,
          }, creditsForUsage, AUTOFILL_CREDIT_COST);
          await commitAiCompositionDocument({
            html: result.html,
            visualEngine: result.visualEngine,
          }, {
            // A preview is user-visible delivery. Keep it buffered until the
            // credit debit succeeds so every failed request is event-atomic.
            emitPreview: (html) => { committedPreview = html; },
            persist: async (data) => {
              emit("progress", { stage: "persisting" });
              await (options.commitProjectAndDebit ?? commitCurateProjectAndDebit)({
                projectId,
                userId,
                title: result.title,
                brief,
                profileId: profile.id,
                logoUrl: profile.data.brand?.logoUrl ?? null,
                credits,
                data,
              });
            },
          });
        } catch {
          await result.failFableTelemetry?.("delivery", "persistence_failed");
          captureFailure("persistence", "persistence_failed");
          return fail("persistence_failed");
        }

        if (committedPreview === null) {
          await result.failFableTelemetry?.("delivery", "persistence_failed");
          captureFailure("persistence", "persistence_failed");
          return fail("persistence_failed");
        }

        // Flush redacted Fable accounting only after the atomic project+debit
        // statement. A telemetry sink failure is intentionally non-fatal.
        await result.finalizeFableTelemetry?.();

        emit("preview", { html: committedPreview });

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
        if (heartbeat !== undefined) clearInterval(heartbeat);
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
};
}

function errorJson(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
