import { generateImage } from "@/lib/together/client";
import type { GeneratedImage, ImagePrompt } from "./types";
import { fallbackCount, pickImageModel } from "./routing";
import { emit, emitStepResult, type StepContext } from "./_shared";

// ─────────────────────────────────────────────────────────────────────────────
// Image generation step.
//
// Two parallel batches:
//   - hero  → FLUX.2-pro (one image)
//   - decorative / feature_icon / background → Wan-2.6-Image (rest, in parallel)
//
// Per the brief, image failures degrade gracefully: a single image failing
// emits a warning and continues without it, rather than failing the entire
// page generation.
// ─────────────────────────────────────────────────────────────────────────────

// Hard cap on supporting images so a runaway plan can't blow the image
// budget. 1 hero + 3 decoratives = $0.12 max at $0.03/image.
const MAX_DECORATIVE_IMAGES = 3;

export async function generateImages(
  ctx: StepContext,
  prompts: ImagePrompt[],
): Promise<GeneratedImage[]> {
  if (prompts.length === 0) return [];

  const hero = prompts.find((p) => p.purpose === "hero");
  const rest = prompts
    .filter((p) => p.purpose !== "hero")
    .slice(0, MAX_DECORATIVE_IMAGES);

  const tasks: Promise<GeneratedImage | null>[] = [];
  if (hero) tasks.push(runOne(ctx, hero, "image_hero"));
  for (const p of rest) tasks.push(runOne(ctx, p, "image_decorative"));

  const settled = await Promise.allSettled(tasks);
  const images: GeneratedImage[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled" && r.value) images.push(r.value);
  }
  return images;
}

async function runOne(
  ctx: StepContext,
  prompt: ImagePrompt,
  step: "image_hero" | "image_decorative",
): Promise<GeneratedImage | null> {
  emit(ctx, {
    type: "progress",
    step,
    status: "started",
    details: `Rendering ${prompt.purpose} image: ${prompt.id}`,
  });

  // Primary first, then walk every defined fallback. If no fallbacks exist
  // for the step, primary is the only attempt. Beyond that we degrade
  // gracefully (return null, omit from final page).
  const attempts: Array<{ fallbackIndex?: number }> = [
    {},
    ...Array.from({ length: fallbackCount(step) }, (_, idx) => ({ fallbackIndex: idx })),
  ];

  let lastError: unknown = null;
  for (let i = 0; i < attempts.length; i++) {
    const { fallbackIndex } = attempts[i];
    try {
      const decision = pickImageModel({ step, fallbackIndex });
      ctx.budget.guard();
      const result = await generateImage({
        model: decision.model,
        prompt: prompt.prompt,
        aspectRatio: prompt.aspectRatio,
      });

      await ctx.recorder.record({
        step,
        decision,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: result.latencyMs,
        costUsd: result.costUsd,
        mocked: result.mocked,
        note: i > 0 ? `image fallback attempt ${i}` : undefined,
      });
      ctx.budget.add(step, result.costUsd);

      const generated: GeneratedImage = {
        id: prompt.id,
        url: result.url,
        purpose: prompt.purpose,
        prompt: prompt.prompt,
        model: decision.model,
      };

      emitStepResult(ctx, { step, data: generated });

      emit(ctx, {
        type: "progress",
        step,
        status: "completed",
        details: `Rendered ${prompt.id}`,
        costSoFar: ctx.budget.total(),
      });

      return generated;
    } catch (err) {
      lastError = err;
      // No more fallbacks → degrade gracefully.
      if (i === attempts.length - 1) {
        emit(ctx, {
          type: "progress",
          step,
          status: "skipped",
          details: `Skipped ${prompt.id} after ${attempts.length} attempts: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
        return null;
      }
    }
  }

  // unreachable — defensive
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
