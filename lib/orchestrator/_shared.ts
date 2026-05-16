import type { ChatMessage, TextCallRequest } from "@/lib/together/client";
import { completeText } from "@/lib/together/client";
import type { PipelineStep, ProgressEvent } from "./types";
import type { Budget } from "@/lib/budget";
import type { Recorder } from "@/lib/witness/recorder";
import { pickTextModel, ROUTING_TABLE } from "./routing";

// ─────────────────────────────────────────────────────────────────────────────
// Shared step context — threaded through every pipeline step.
//
// `onProgress` is the SSE bridge. Steps call it before/after each model call
// so the UI can paint progress. The shape matches `ProgressEvent` so the API
// route can ship it directly down the wire without remapping.
// ─────────────────────────────────────────────────────────────────────────────

export interface StepContext {
  brief: string;
  generationId: string;
  recorder: Recorder;
  budget: Budget;
  fastPath: boolean;
  onProgress?: (event: ProgressEvent) => void;
}

export interface TextCallPlan<T> {
  step: PipelineStep;
  buildMessages: () => ChatMessage[];
  /** Validate + transform the raw `content` string into a typed result. Throw to trigger fallback. */
  validate: (content: string) => T;
  /** When MOCK_MODE is on, this tells the dispatcher which canned response to emit. */
  mockKey?: string;
  /** Per-call overrides for the SDK (temperature, max tokens, response format). */
  callOptions?: Pick<TextCallRequest, "temperature" | "maxTokens" | "responseFormat">;
  /** Optional progress detail attached to the `started`/`completed` events. */
  progressDetail?: string;
  /** Use the fastPath model from the routing table instead of primary. */
  useFastPath?: boolean;
  /** A note attached to the witness record when this call is a fallback. */
  fallbackNote?: string;
}

/**
 * Run a text-step with automatic fallback through the routing chain.
 *
 * Order of operations:
 *   1. progress.started
 *   2. attempt primary; on validate() throw, walk fallbacks[]
 *   3. record witness + add to budget for each attempt (success or failure)
 *   4. progress.completed (or progress.fallback if any attempt failed)
 */
export async function runTextStep<T>(
  ctx: StepContext,
  plan: TextCallPlan<T>,
): Promise<T> {
  emit(ctx, {
    type: "progress",
    step: plan.step,
    status: "started",
    details: plan.progressDetail,
  });

  const entry = ROUTING_TABLE[plan.step];
  // Inference here is intentional: pickTextModel returns a narrowed
  // RoutingDecision whose `model` is typed as TextModelId. An explicit
  // `Array<{decision: RoutingDecision; ...}>` annotation would widen it back
  // to `string`, breaking the call to `completeText` below.
  const attempts = [
    {
      decision: pickTextModel({
        step: plan.step,
        fastPath: plan.useFastPath ?? false,
      }),
      fallbackIndex: undefined as number | undefined,
    },
    ...entry.fallbacks.map((_, idx) => ({
      decision: pickTextModel({
        step: plan.step,
        fallbackIndex: idx,
        reasonOverride: plan.fallbackNote,
      }),
      fallbackIndex: idx as number | undefined,
    })),
  ];

  let lastError: unknown = null;
  for (let i = 0; i < attempts.length; i++) {
    const { decision } = attempts[i];
    if (i > 0) {
      emit(ctx, {
        type: "progress",
        step: plan.step,
        status: "fallback",
        details: `Retrying with ${decision.model}`,
      });
    }

    ctx.budget.guard();
    const messages = plan.buildMessages();
    const callResult = await completeText({
      model: decision.model,
      messages,
      responseFormat: plan.callOptions?.responseFormat,
      temperature: plan.callOptions?.temperature,
      maxTokens: plan.callOptions?.maxTokens,
      mockKey: plan.mockKey,
    });

    await ctx.recorder.record({
      step: plan.step,
      decision,
      inputTokens: callResult.inputTokens,
      outputTokens: callResult.outputTokens,
      latencyMs: callResult.latencyMs,
      costUsd: callResult.costUsd,
      mocked: callResult.mocked,
      note: i > 0 ? `fallback attempt ${i}` : undefined,
    });
    ctx.budget.add(plan.step, callResult.costUsd);

    try {
      const validated = plan.validate(callResult.content);
      emit(ctx, {
        type: "progress",
        step: plan.step,
        status: "completed",
        details: plan.progressDetail,
        costSoFar: ctx.budget.total(),
      });
      return validated;
    } catch (err) {
      lastError = err;
      if (i === attempts.length - 1) break;
      // loop to fallback
    }
  }

  throw new Error(
    `Step "${plan.step}" failed after ${attempts.length} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

export function emit(ctx: StepContext, event: ProgressEvent): void {
  ctx.onProgress?.(event);
}

/** Parse JSON or throw — used by validators that want a thrown error to trigger fallback. */
export function parseJson<T>(content: string, label: string): T {
  try {
    return JSON.parse(content) as T;
  } catch (err) {
    throw new Error(
      `${label}: model returned invalid JSON (${(err as Error).message}). First 200 chars: ${content.slice(0, 200)}`,
    );
  }
}
