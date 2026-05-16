import { randomUUID } from "node:crypto";
import { createBudget, BudgetExceededError } from "@/lib/budget";
import { createRecorder } from "@/lib/witness/recorder";
import { GenerateRequestSchema } from "./types";
import type {
  GenerateRequest,
  ImagePrompt,
  Intent,
  LandingPage,
  Plan,
  ProgressEvent,
  StepResultEvent,
} from "./types";
import { shouldUseFastPath } from "./routing";
import { classify } from "./classify";
import { plan as planStep } from "./plan";
import { fillAllBlocks } from "./fill";
import { generateImages } from "./images";
import { assemble } from "./assemble";
import { DEFAULT_PALETTE, type StepContext } from "./_shared";
import { PALETTES, selectPalette } from "./design-tokens";

// ─────────────────────────────────────────────────────────────────────────────
// Main orchestrator — slot-filling pipeline.
//
// Flow:
//   classify → plan → [fill + images in parallel] → assemble (deterministic)
//
// The AI never writes HTML. The `plan` step picks block IDs from the registry,
// `fill` produces validated slot JSON for each block (in parallel), `images`
// generates the hero + decoratives, and `assemble` calls renderToStaticMarkup
// to stitch the final HTML document. Bug-loop class of failures is impossible
// by construction — there is no markup-generating model in the chain.
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

    // Plan dictates which palette the assembled page uses (the AI may pick
    // a different one from our default selection based on aesthetic fit).
    ctx.palette = PALETTES[plan.palette];

    // Fan-out: fill all blocks + generate images in parallel.
    const imagePrompts = buildImagePrompts(intent, plan);
    const [filledBlocks, images] = await Promise.all([
      fillAllBlocks(ctx, { plan, intent }),
      generateImages(ctx, imagePrompts),
    ]);

    // Deterministic assembly — no LLM call.
    const page = await assemble({
      ctx,
      brief: parsed.brief,
      generationId,
      intent,
      plan,
      filledBlocks,
      images,
      cost: budget.breakdown(),
      witnessPath: recorder.path,
      adaptiveFastPath: fastPath,
    });

    return page;
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      throw err;
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Image prompts derived from intent + plan.imageNeeds. The plan no longer
// emits image prompts directly — that work is deterministic now, freeing the
// plan step's output token budget to focus on block sequencing.
// ─────────────────────────────────────────────────────────────────────────────

function buildImagePrompts(intent: Intent, plan: Plan): ImagePrompt[] {
  const prompts: ImagePrompt[] = [];

  if (plan.imageNeeds.hero) {
    prompts.push({
      id: "hero",
      purpose: "hero",
      prompt: buildHeroPrompt(intent, plan),
      aspectRatio: "16:9",
    });
  }

  const decorativeCount = Math.min(plan.imageNeeds.decorative, 3);
  for (let i = 0; i < decorativeCount; i++) {
    prompts.push({
      id: `decorative-${i + 1}`,
      purpose: "decorative",
      prompt: buildDecorativePrompt(intent, plan, i),
      aspectRatio: "4:3",
    });
  }

  return prompts;
}

function buildHeroPrompt(intent: Intent, plan: Plan): string {
  const subject = intent.productName
    ? `${intent.productName} (${intent.industry})`
    : `${intent.industry} product`;
  const styleHint = aestheticStyleHint(plan.aesthetic);
  return `Product hero for ${subject} aimed at ${intent.audience}. ${styleHint}. ${intent.tone} mood. Composition: high-detail UI mockup or geometric composition. No text overlay. Cinematic 16:9, editorial photography quality.`;
}

function buildDecorativePrompt(
  intent: Intent,
  plan: Plan,
  index: number,
): string {
  const themes = ["workflow detail", "feature surface", "ambient texture"];
  const theme = themes[index] ?? "supporting visual";
  const styleHint = aestheticStyleHint(plan.aesthetic);
  return `Decorative ${theme} for ${intent.industry}, ${intent.tone} register. ${styleHint}. Subject: abstract or product detail, no faces, no readable text. 4:3 framing.`;
}

function aestheticStyleHint(aesthetic: Plan["aesthetic"]): string {
  switch (aesthetic) {
    case "technical-minimal":
      return "Tight grid, hairline borders, near-monochrome palette with a single accent";
    case "refined-editorial":
      return "Serif typography sensibility, high contrast, generous negative space";
    case "warm-humanist":
      return "Rounded forms, off-white grounds, soft shadows, earth-tone accents";
    case "editorial-maximalist":
      return "Oversized type sensibility, asymmetric framing, color blocks visible";
    case "brutalist-technical":
      return "Hard mono, raw borders, deliberate restraint, visible structural grid";
    default:
      return "Restrained, premium-feeling composition";
  }
}

export { BudgetExceededError };
