import { randomUUID } from "node:crypto";
import { createBudget, BudgetExceededError } from "@/lib/budget";
import { createRecorder } from "@/lib/witness/recorder";
import { GenerateRequestSchema } from "./types";
import type {
  GenerateRequest,
  LandingPage,
  ProgressEvent,
  StepResultEvent,
} from "./types";
import { shouldUseFastPath } from "./routing";
import { classify } from "./classify";
import { plan as planStep } from "./plan";
import { generateCopy } from "./copy";
import { generateHtml } from "./html";
import { generateImages } from "./images";
import { assemble } from "./assemble";
import { DEFAULT_PALETTE, type StepContext } from "./_shared";
import { PALETTES, selectPalette } from "./design-tokens";

// ─────────────────────────────────────────────────────────────────────────────
// Main orchestrator.
//
// Pipeline:
//   classify → plan → [images in parallel with copy] → html (after copy) →
//   assemble (after html + images both settle).
//
// Image generation starts as soon as the plan resolves rather than waiting on
// copy, because images depend only on plan.imagePrompts. HTML waits on copy.
// `Promise.all` at the end waits for both branches before assembling.
// ─────────────────────────────────────────────────────────────────────────────

export interface GenerateOptions extends GenerateRequest {
  onProgress?: (event: ProgressEvent) => void;
  onStepResult?: (event: StepResultEvent) => void;
}

export async function generateLandingPage(
  options: GenerateOptions,
): Promise<LandingPage> {
  const parsed = GenerateRequestSchema.parse({
    brief: options.brief,
    maxBudget: options.maxBudget,
    fastPath: options.fastPath,
  });

  const generationId = randomUUID();
  const recorder = createRecorder(generationId);
  const budget = createBudget({ cap: parsed.maxBudget });
  const fastPath = shouldUseFastPath(parsed.brief, parsed.fastPath);

  const ctx: StepContext = {
    brief: parsed.brief,
    generationId,
    recorder,
    budget,
    fastPath,
    // Classify runs before intent exists, so start on the universal default
    // (mono-dark). After classify resolves we re-pick based on intent signals
    // and every downstream step sees the chosen palette.
    palette: DEFAULT_PALETTE,
    onProgress: options.onProgress,
    onStepResult: options.onStepResult,
  };

  try {
    const intent = await classify(ctx);
    ctx.palette = PALETTES[selectPalette({
      industry: intent.industry,
      audience: intent.audience,
      tone: intent.tone,
      signals: intent.goals,
    })];
    const plan = await planStep(ctx, intent);

    // Kick off images immediately — they only need the plan, not copy.
    const imagesPromise = generateImages(ctx, plan.imagePrompts);

    // Copy must complete before HTML can start.
    const copy = await generateCopy(ctx, plan);

    // HTML in parallel with any remaining image work.
    const [html, images] = await Promise.all([
      generateHtml(ctx, plan, copy),
      imagesPromise,
    ]);

    return assemble({
      brief: parsed.brief,
      generationId,
      intent,
      plan,
      copy,
      html,
      images,
      cost: budget.breakdown(),
      witnessPath: recorder.path,
      adaptiveFastPath: fastPath,
    });
  } catch (err) {
    // Tag known errors so the API layer can map them to recoverable=true.
    if (err instanceof BudgetExceededError) {
      throw err;
    }
    throw err;
  }
}

export { BudgetExceededError };
