import { z } from "zod";
import type { ChatMessage } from "@/lib/together/client";
import { completeText } from "@/lib/together/client";
import { buildSystemMessageForStep, pickTextModel } from "./routing";
import type { HtmlOutput } from "./html";
import { emit, parseJson, type StepContext } from "./_shared";

// ─────────────────────────────────────────────────────────────────────────────
// Refine step.
//
// Last-resort recovery for the html step. When both Qwen3-Coder-Next and
// DeepSeek V4 Pro produce HTML that fails the quality gates, refine takes the
// FAILING html + the specific issue and asks Qwen3.5-9B to patch it. This is
// cheap (~$0.001 per call) and surprisingly effective for narrow fixes like
// missing alt attributes, unbalanced tags, or stray markdown fences.
//
// NOT a creative pass — refine never rewrites copy or restructures sections.
// It only fixes the listed issue while preserving the rest of the document.
// ─────────────────────────────────────────────────────────────────────────────

const HtmlOutputSchema = z.object({
  html: z.string().min(50),
  css: z.string().min(20),
});

async function buildRefineMessages(
  ctx: StepContext,
  prevContent: string,
  issue: string,
): Promise<{ messages: ChatMessage[]; fewShotVariants: string[] }> {
  const system = await buildSystemMessageForStep("refine", {
    palette: ctx.palette,
  });
  return {
    messages: [
      { role: "system", content: system.content, cache: true },
      {
        role: "user",
        content: `Issue to fix: ${issue}\n\nCurrent payload (raw model output, may include the JSON wrapper):\n${prevContent}`,
      },
    ],
    fewShotVariants: system.fewShotVariants,
  };
}

/**
 * Run refine on a failing html-step output. Returns a fixed `HtmlOutput` or
 * throws if even the patch model can't produce valid output.
 *
 * Wired in `html.ts` via `runTextStep`'s `lastResort` hook.
 */
export async function refineHtml(
  ctx: StepContext,
  prevContent: string,
  prevError: Error,
): Promise<HtmlOutput> {
  emit(ctx, {
    type: "progress",
    step: "refine",
    status: "started",
    details: `Refining HTML to fix: ${prevError.message}`,
  });

  const decision = pickTextModel({ step: "refine" });
  ctx.budget.guard();

  const { messages, fewShotVariants } = await buildRefineMessages(
    ctx,
    prevContent,
    prevError.message,
  );
  const result = await completeText({
    model: decision.model,
    messages,
    responseFormat: "json",
    temperature: 0.2,
    maxTokens: 8192,
  });

  await ctx.recorder.record({
    step: "refine",
    decision,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    latencyMs: result.latencyMs,
    costUsd: result.costUsd,
    mocked: result.mocked,
    note: `recovery from html: ${prevError.message.slice(0, 120)}`,
    palette: ctx.palette.name,
    fewShotVariants: fewShotVariants.length > 0 ? fewShotVariants : undefined,
  });
  ctx.budget.add("refine", result.costUsd);

  const parsed = parseJson<unknown>(result.content, "refine");
  const out = HtmlOutputSchema.parse(parsed);

  emit(ctx, {
    type: "progress",
    step: "refine",
    status: "completed",
    details: "HTML refined",
    costSoFar: ctx.budget.total(),
  });

  return out;
}
