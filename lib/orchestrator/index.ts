import { randomUUID } from "node:crypto";
import { createBudget, BudgetExceededError } from "@/lib/budget";
import { createRecorder } from "@/lib/witness/recorder";
import { GenerateRequestSchema } from "./types";
import type {
  FilledBlock,
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
import { refineBlocks } from "./refine";
import {
  disposeGateResources,
  runAllGates,
  type GatesAggregateResult,
} from "@/lib/gates";
import { DEFAULT_PALETTE, emit, emitStepResult, type StepContext } from "./_shared";
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
    let [filledBlocks, images] = await Promise.all([
      fillAllBlocks(ctx, { plan, intent }),
      generateImages(ctx, imagePrompts),
    ]);

    // Deterministic assembly — no LLM call.
    let page = await assemble({
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

    // ── Quality gates + refine loop. ─────────────────────────────────────
    // Run all six gates in parallel. If any critical violations exist, the
    // refine loop re-fills the offending blocks and re-assembles. Capped at
    // MAX_REFINE_ATTEMPTS to bound runtime + spend; whatever remains after
    // the cap ships with qualityGrade: "needs_review" in meta.
    const gateOutcome = await runGatesWithRefine({
      ctx,
      intent,
      plan,
      filledBlocks,
      images,
      page,
      brief: parsed.brief,
      generationId,
      fastPath,
    });

    filledBlocks = gateOutcome.filledBlocks;
    page = gateOutcome.page;

    // Attach final quality grade + gate results to page meta.
    page.meta.qualityGrade = computeQualityGrade(
      gateOutcome.gatesResult,
      gateOutcome.attempts,
    );
    page.meta.gateResults = gateOutcome.gatesResult;
    page.meta.refineAttempts = gateOutcome.attempts;
    page.cost = budget.breakdown();

    // Emit the final aggregate gate result to anyone listening on the
    // step_result channel — the UI uses this to render the quality badge.
    emitStepResult(ctx, { step: "gates", data: gateOutcome.gatesResult });

    return page;
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      throw err;
    }
    throw err;
  } finally {
    // Always tear down the puppeteer browser. Even if the run threw before
    // gates ran, _browser.ts may have been imported elsewhere (e.g. tests).
    await disposeGateResources();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Gates + refine loop helpers.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_REFINE_ATTEMPTS = 2;

interface GatesWithRefineArgs {
  ctx: StepContext;
  intent: Intent;
  plan: Plan;
  filledBlocks: FilledBlock[];
  images: Awaited<ReturnType<typeof generateImages>>;
  page: LandingPage;
  brief: string;
  generationId: string;
  fastPath: boolean;
}

interface GatesWithRefineResult {
  page: LandingPage;
  filledBlocks: FilledBlock[];
  gatesResult: GatesAggregateResult;
  attempts: number;
}

async function runGatesWithRefine(
  args: GatesWithRefineArgs,
): Promise<GatesWithRefineResult> {
  const { ctx, intent, plan, images, brief, generationId, fastPath } = args;
  let { filledBlocks, page } = args;

  emit(ctx, {
    type: "progress",
    step: "gates",
    status: "started",
    details: "Running 6 quality gates in parallel",
  });

  let gatesResult = await runAllGatesAndRecord(ctx, page, plan, filledBlocks);

  emit(ctx, {
    type: "progress",
    step: "gates",
    status: "completed",
    details: `${Object.values(gatesResult.byGate).filter((g) => g.passed).length}/6 gates passed (${gatesResult.criticalViolations.length} critical)`,
    costSoFar: ctx.budget.total(),
  });

  let attempts = 0;

  while (!gatesResult.passed && attempts < MAX_REFINE_ATTEMPTS) {
    attempts++;

    emit(ctx, {
      type: "progress",
      step: "refine",
      status: "started",
      refineAttempt: attempts,
      details: `Refine attempt ${attempts}/${MAX_REFINE_ATTEMPTS} — re-filling ${gatesResult.criticalViolations.length} critical violation(s)`,
    });

    const refineResult = await refineBlocks(ctx, {
      violations: gatesResult.criticalViolations,
      plan,
      filledBlocks,
      intent,
      attempt: attempts,
    });

    filledBlocks = refineResult.filledBlocks;

    // Early-out: if no blocks were re-filled, the page state is identical to
    // the previous attempt. Re-assembling + re-running 6 gates would burn
    // ~10s for no possible change. Bail and let the page ship with
    // `qualityGrade: needs_review`. This happens when every critical
    // violation is unattributable to a specific block (e.g. a page-level
    // conversion judge failure, or a violation whose ancestor lacks the
    // `data-section-id="block-N"` marker), or when the violation lives in
    // hardcoded block markup that fill-step retries cannot affect.
    if (refineResult.refinedBlockIndices.length === 0) {
      emit(ctx, {
        type: "progress",
        step: "refine",
        status: "skipped",
        refineAttempt: attempts,
        details: `Refine attempt ${attempts} re-filled 0 blocks (no attributable violations); skipping remaining attempts`,
        costSoFar: ctx.budget.total(),
      });
      await ctx.recorder.record({
        step: "refine",
        decision: {
          step: "fill",
          model: "deterministic",
          reason: "refine early-out: 0 blocks attributable, identical state",
          isFallback: false,
          fallbackChain: [],
        },
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        costUsd: 0,
        mocked: false,
        palette: ctx.palette.name,
        deterministic: true,
        refineAttempt: attempts,
        refinedBlockIndices: [],
        remainingCriticalViolations: gatesResult.criticalViolations.length,
        note: `${refineResult.unattributedViolationCount} unattributed violation(s) — refine has no work to do`,
      });
      break;
    }

    // Re-assemble with the refined blocks.
    page = await assemble({
      ctx,
      brief,
      generationId,
      intent,
      plan,
      filledBlocks,
      images,
      cost: ctx.budget.breakdown(),
      witnessPath: ctx.recorder.path,
      adaptiveFastPath: fastPath,
    });

    // Re-run gates.
    gatesResult = await runAllGatesAndRecord(ctx, page, plan, filledBlocks);

    await ctx.recorder.record({
      step: "refine",
      decision: {
        step: "fill",
        model: "deterministic",
        reason: `refine pass ${attempts}/${MAX_REFINE_ATTEMPTS} re-filled ${refineResult.refinedBlockIndices.length} block(s)`,
        isFallback: false,
        fallbackChain: [],
      },
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      costUsd: 0,
      mocked: false,
      palette: ctx.palette.name,
      deterministic: true,
      refineAttempt: attempts,
      refinedBlockIndices: refineResult.refinedBlockIndices,
      remainingCriticalViolations: gatesResult.criticalViolations.length,
      note: `${refineResult.unattributedViolationCount} unattributed violation(s) skipped`,
    });

    emit(ctx, {
      type: "progress",
      step: "refine",
      status: "completed",
      refineAttempt: attempts,
      details: `${refineResult.refinedBlockIndices.length} block(s) re-filled; ${gatesResult.criticalViolations.length} critical violation(s) remain`,
      costSoFar: ctx.budget.total(),
    });
  }

  return { page, filledBlocks, gatesResult, attempts };
}

async function runAllGatesAndRecord(
  ctx: StepContext,
  page: LandingPage,
  plan: Plan,
  filledBlocks: FilledBlock[],
): Promise<GatesAggregateResult> {
  const result = await runAllGates(
    {
      html: page.html,
      css: page.css,
      meta: page.meta,
      blockSequence: plan.blockSequence.map((b, i) => ({
        blockId: b.blockId,
        index: i,
      })),
      filledBlocks,
    },
    {
      onGateComplete: (gate) => {
        emit(ctx, {
          type: "progress",
          step: "gates",
          status: "completed",
          gateId: gate.gate,
          gatePassed: gate.passed,
          gateViolationCount: gate.violations.length,
          details: `${gate.gate}: ${gate.passed ? "pass" : "fail"} (${gate.violations.length} violations, ${gate.durationMs}ms)`,
        });
      },
    },
  );

  // Per-gate witness records.
  for (const g of Object.values(result.byGate)) {
    await ctx.recorder.record({
      step: "gates",
      decision: {
        step: g.gate === "conversion" ? "fill" : "assemble",
        model: g.gate === "conversion" ? "lfm2-24b-a2b" : "deterministic",
        reason: `quality gate: ${g.gate}`,
        isFallback: false,
        fallbackChain: [],
      },
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: g.durationMs,
      costUsd: g.cost,
      mocked: false,
      palette: ctx.palette.name,
      deterministic: g.gate !== "conversion",
      gateId: g.gate,
      gatePassed: g.passed,
      gateViolationCount: g.violations.length,
      note:
        g.violations.length > 0
          ? `top violation: ${g.violations[0].code} — ${g.violations[0].message.slice(0, 80)}`
          : undefined,
    });
    if (g.cost > 0) ctx.budget.add("gates", g.cost);
  }

  return result;
}

function computeQualityGrade(
  result: GatesAggregateResult,
  attempts: number,
): "passed" | "needs_review" | "warning" {
  // "passed" = no critical violations. Warning-level violations don't
  // downgrade — they're informational (e.g. missing OG tags, small tap
  // targets that fall below 44px but above the implicit 32px floor).
  if (result.passed) return "passed";
  // Still failing critical after MAX_REFINE_ATTEMPTS — page ships but the
  // operator should look at it before pointing customers to it.
  return attempts >= MAX_REFINE_ATTEMPTS ? "needs_review" : "warning";
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
