import { randomUUID } from "node:crypto";
import { createBudget } from "@/lib/budget";
import { createRecorder } from "@/lib/witness/recorder";
import { fillBlock } from "./fill";
import { assemble } from "./assemble";
import { stripImageSlots } from "./index";
import type {
  CostBreakdown,
  FilledBlock,
  GeneratedImage,
  Intent,
  LandingPage,
  Plan,
} from "./types";
import { DEFAULT_PALETTE, type StepContext } from "./_shared";
import { PALETTES } from "./design-tokens";

// ─────────────────────────────────────────────────────────────────────────────
// Single-block regeneration.
//
// Re-runs the fill step for ONE block in plan.blockSequence (optionally with
// an extra user instruction baked into the block's emphasis), splices the
// new FilledBlock into the filledBlocks array, then re-runs the deterministic
// assemble step to produce a new full HTML document.
//
// Image generation is NOT re-run — the page keeps its existing images. This
// matches the user's mental model of "regenerate this section only".
// ─────────────────────────────────────────────────────────────────────────────

export interface RegenerateBlockInput {
  brief: string;
  intent: Intent;
  plan: Plan;
  filledBlocks: FilledBlock[];
  images: GeneratedImage[];
  /** Index in plan.blockSequence (0-based) of the block to re-fill. */
  blockIndex: number;
  additionalInstruction?: string;
}

export interface RegenerateBlockResult {
  page: LandingPage;
  generationId: string;
  cost: CostBreakdown;
}

export async function regenerateBlock(
  input: RegenerateBlockInput,
): Promise<RegenerateBlockResult> {
  const generationId = `regen-${randomUUID()}`;
  const recorder = createRecorder(generationId);
  // One block fill + a deterministic assemble = a few hundredths of a cent.
  // Generous cap to absorb fallback retries.
  const budget = createBudget({ cap: 0.5 });

  const ctx: StepContext = {
    brief: input.brief,
    generationId,
    recorder,
    budget,
    fastPath: false,
    palette: PALETTES[input.plan.palette] ?? DEFAULT_PALETTE,
  };

  const seqEntry = input.plan.blockSequence[input.blockIndex];
  if (!seqEntry) {
    throw new Error(
      `regenerate-block: blockIndex ${input.blockIndex} out of bounds (sequence length ${input.plan.blockSequence.length})`,
    );
  }

  // Layer the user's additional instruction onto the block's emphasis so the
  // fill step sees it as block-specific guidance.
  const emphasis = input.additionalInstruction
    ? [seqEntry.emphasis, `User instruction: ${input.additionalInstruction}`]
        .filter(Boolean)
        .join(" — ")
    : seqEntry.emphasis;

  const newFilled = await fillBlock(ctx, {
    blockId: seqEntry.blockId,
    index: input.blockIndex,
    intent: input.intent,
    plan: input.plan,
    purpose: seqEntry.purpose,
    emphasis,
  });

  let splicedFilledBlocks = input.filledBlocks.map((fb) =>
    fb.index === input.blockIndex ? newFilled : fb,
  );

  // No-image preference inheritance: if the original generation opted out of
  // AI imagery (plan.imageNeeds zero), the fill step still emits the example
  // imageSrc URLs from the schema. Strip them so the regenerated block
  // matches the rest of the text-only page instead of dropping in a stray
  // Unsplash placeholder.
  const noImageMode =
    !input.plan.imageNeeds.hero && input.plan.imageNeeds.decorative === 0;
  if (noImageMode) {
    splicedFilledBlocks = stripImageSlots(splicedFilledBlocks);
  }

  const page = await assemble({
    ctx,
    brief: input.brief,
    generationId,
    intent: input.intent,
    plan: input.plan,
    filledBlocks: splicedFilledBlocks,
    images: input.images,
    cost: budget.breakdown(),
    witnessPath: recorder.path,
    adaptiveFastPath: false,
  });

  return {
    page,
    generationId,
    cost: budget.breakdown(),
  };
}
