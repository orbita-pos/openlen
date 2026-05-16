import type { ChatMessage } from "@/lib/together/client";
import { completeText } from "@/lib/together/client";
import { getBlock, type BlockId } from "@/lib/blocks/_registry";
import type { FilledBlock, Intent, Plan } from "./types";
import { buildSystemMessageForStep, fallbackCount, pickTextModel } from "./routing";
import { emit, emitStepResult, parseJson, type StepContext } from "./_shared";

// ─────────────────────────────────────────────────────────────────────────────
// Fill step.
//
// For each block in `plan.blockSequence`, ask the model for a slot JSON that
// validates against the block's own Zod schema. The pipeline replaces the
// older `copy + html` pair: no markup ever leaves the AI, just structured
// data that the deterministic `assemble` step turns into HTML.
//
// Each fill is independent — `fillAllBlocks` runs them in parallel. A single
// block's failure does NOT halt the page; the last-resort path falls back to
// the block's `exampleSlots` so something renders.
//
// Costs at qwen3-235b-tput pricing: ~200 input + ~200 output tokens per fill
// ≈ $0.0002 per block. 6 blocks ≈ $0.0012 total fill cost.
// ─────────────────────────────────────────────────────────────────────────────

export interface FillBlockArgs {
  blockId: BlockId;
  index: number;
  intent: Intent;
  plan: Plan;
  purpose: string;
  emphasis?: string;
}

export interface FillAllArgs {
  plan: Plan;
  intent: Intent;
}

export async function fillAllBlocks(
  ctx: StepContext,
  args: FillAllArgs,
): Promise<FilledBlock[]> {
  // Guard once before kicking off the parallel batch — fail fast if even the
  // optimistic projection would blow the cap.
  ctx.budget.guard();

  const tasks = args.plan.blockSequence.map((entry, index) =>
    fillBlock(ctx, {
      blockId: entry.blockId,
      index,
      intent: args.intent,
      plan: args.plan,
      purpose: entry.purpose,
      emphasis: entry.emphasis,
    }),
  );

  // Promise.all rejects on first failure — but fillBlock has its own fallback
  // chain ending in `examplelotsFallback`, so it should never reject. If a
  // block does throw (e.g. the registry lookup), the whole generation fails
  // with a meaningful error and the witness file shows where.
  return Promise.all(tasks);
}

export async function fillBlock(
  ctx: StepContext,
  args: FillBlockArgs,
): Promise<FilledBlock> {
  const block = getBlock(args.blockId);

  emit(ctx, {
    type: "progress",
    step: "fill",
    status: "started",
    details: `Filling slots for block ${args.index + 1}: ${args.blockId}`,
    blockIndex: args.index,
    blockId: args.blockId,
  });

  // System message is stable across all blocks in a generation, so Together's
  // prompt cache will hit after the first fill. Per-block specifics ride in
  // the user message — never cached, always fresh.
  const system = await buildSystemMessageForStep("fill", {
    palette: ctx.palette,
    intent: args.intent,
    plan: args.plan,
  });

  // Per-block user prompt: identity + example shape + constraints.
  const userPrompt = buildFillUserPrompt({
    blockId: args.blockId,
    blockDescription: block.meta.description,
    purpose: args.purpose,
    emphasis: args.emphasis,
    exampleSlots: block.meta.exampleSlots,
    intent: args.intent,
    aesthetic: args.plan.aesthetic,
    brief: ctx.brief,
  });

  const messages: ChatMessage[] = [
    { role: "system", content: system.content, cache: true },
    { role: "user", content: userPrompt },
  ];

  // Walk the routing chain: primary → fallbacks → exampleSlots fallback.
  const attempts = buildAttemptList();
  let lastError: unknown = null;
  let lastContent = "";

  for (let i = 0; i < attempts.length; i++) {
    const { fallbackIndex } = attempts[i];
    const decision = pickTextModel({
      step: "fill",
      fallbackIndex,
      reasonOverride:
        i > 0
          ? `Retrying block ${args.blockId} after validation failure: ${
              lastError instanceof Error ? lastError.message.slice(0, 80) : "unknown"
            }`
          : undefined,
    });

    if (i > 0) {
      emit(ctx, {
        type: "progress",
        step: "fill",
        status: "fallback",
        details: `Retrying block ${args.blockId} with ${decision.model}`,
        blockIndex: args.index,
        blockId: args.blockId,
      });
    }

    ctx.budget.guard();
    const messagesForCall = appendRetryFeedback(messages, lastError, i);
    const callResult = await completeText({
      model: decision.model,
      messages: messagesForCall,
      mockKey: "fill",
      responseFormat: "json",
      temperature: 0.3,
      maxTokens: 1024,
    });

    await ctx.recorder.record({
      step: "fill",
      decision,
      inputTokens: callResult.inputTokens,
      outputTokens: callResult.outputTokens,
      latencyMs: callResult.latencyMs,
      costUsd: callResult.costUsd,
      mocked: callResult.mocked,
      note: i > 0 ? `fill retry attempt ${i}` : undefined,
      palette: ctx.palette.name,
      fewShotVariants: system.fewShotVariants,
      blockId: args.blockId,
      blockIndex: args.index,
    });
    ctx.budget.add("fill", callResult.costUsd);
    lastContent = callResult.content;

    try {
      const rawSlots = parseJson<unknown>(callResult.content, `fill:${args.blockId}`);
      const validated = block.meta.slotsSchema.parse(rawSlots);
      const filled: FilledBlock = {
        blockId: args.blockId,
        index: args.index,
        slots: validated,
        fillCost: callResult.costUsd,
        fillTokens: {
          input: callResult.inputTokens,
          output: callResult.outputTokens,
        },
      };

      emitStepResult(ctx, { step: "fill", data: filled });
      emit(ctx, {
        type: "progress",
        step: "fill",
        status: "completed",
        details: `Filled block ${args.index + 1}: ${args.blockId}`,
        costSoFar: ctx.budget.total(),
        blockIndex: args.index,
        blockId: args.blockId,
      });
      return filled;
    } catch (err) {
      lastError = err;
      // loop to next attempt — or fall through to exampleSlots fallback.
    }
  }

  // Last resort: return the block's exampleSlots. The page renders something
  // sensible even when every model in the chain failed validation. The retry
  // record above already accounts for the spend.
  const lastErrorMessage =
    lastError instanceof Error ? lastError.message : String(lastError);

  await ctx.recorder.record({
    step: "fill",
    decision: pickTextModel({ step: "fill" }),
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    costUsd: 0,
    mocked: false,
    note: `fill fallback to exampleSlots: ${lastErrorMessage.slice(0, 120)}. lastContent[0..100]=${lastContent.slice(0, 100)}`,
    palette: ctx.palette.name,
    blockId: args.blockId,
    blockIndex: args.index,
    deterministic: true,
  });

  emit(ctx, {
    type: "progress",
    step: "fill",
    status: "skipped",
    details: `Using exampleSlots for ${args.blockId} after ${attempts.length} failed attempts`,
    blockIndex: args.index,
    blockId: args.blockId,
  });

  const fallback: FilledBlock = {
    blockId: args.blockId,
    index: args.index,
    slots: block.meta.exampleSlots,
    fillCost: 0,
    fillTokens: { input: 0, output: 0 },
  };
  emitStepResult(ctx, { step: "fill", data: fallback });
  return fallback;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface BuildFillUserPromptArgs {
  blockId: BlockId;
  blockDescription: string;
  purpose: string;
  emphasis?: string;
  exampleSlots: unknown;
  intent: Intent;
  aesthetic: string;
  /**
   * Raw brief — included verbatim so the model preserves exact facts (pricing,
   * dates, named speakers, locations). Without this, fill saw only the
   * classifier's lossy Intent summary and routinely invented numbers / drifted
   * facts (Session 6 finding: $99 → $96, Mexican volcanoes → Nicaraguan farms,
   * October virtual event → March SF event).
   */
  brief: string;
}

function buildFillUserPrompt(args: BuildFillUserPromptArgs): string {
  const productLine = args.intent.productName
    ? `Product: ${args.intent.productName}`
    : "Product: derive from the brief context";
  return [
    `Fill slots for ONE block.`,
    ``,
    `Block ID: ${args.blockId}`,
    `Block description: ${args.blockDescription}`,
    `Block purpose on this page: ${args.purpose}`,
    args.emphasis ? `Emphasis: ${args.emphasis}` : "",
    ``,
    `<brief>`,
    args.brief,
    `</brief>`,
    ``,
    `BRIEF FIDELITY (non-negotiable):`,
    `- Reproduce exact facts from the brief: pricing numbers, dates, named people, named places, headcount, ticket prices, product features.`,
    `- Do NOT substitute or "round" prices ($29/mo stays $29/mo, never $24 or $30).`,
    `- Do NOT relocate the product geographically (Mexico stays Mexico, Berlin stays Berlin).`,
    `- Do NOT invent speakers, clients, or testimonial sources beyond what's reasonable for the block; never contradict named people in the brief.`,
    `- If the brief specifies a quantity ("6 projects", "3 case studies", "4 client logos"), match it.`,
    ``,
    `Context:`,
    `${productLine}`,
    `Industry: ${args.intent.industry}`,
    `Audience: ${args.intent.audience}`,
    `Tone: ${args.intent.tone}`,
    `Aesthetic direction: ${args.aesthetic}`,
    args.intent.goals.length > 0 ? `Goals: ${args.intent.goals.join("; ")}` : "",
    ``,
    `Reference example for this block's slot shape (DO NOT COPY copy verbatim — use it only to learn the JSON structure):`,
    "```json",
    JSON.stringify(args.exampleSlots, null, 2),
    "```",
    ``,
    `Output a SINGLE JSON object matching the shape above. Copy must be specific to the brief — no boilerplate, no banned phrases. No markdown, no prose.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildAttemptList(): Array<{ fallbackIndex: number | undefined }> {
  // Primary + every fallback declared in the routing table for the `fill`
  // step. Reading from the routing table keeps this honest if we ever add
  // a fallback model later.
  const attempts: Array<{ fallbackIndex: number | undefined }> = [
    { fallbackIndex: undefined },
  ];
  const fb = fallbackCount("fill");
  for (let i = 0; i < fb; i++) {
    attempts.push({ fallbackIndex: i });
  }
  return attempts;
}

function appendRetryFeedback(
  messages: ChatMessage[],
  lastError: unknown,
  attempt: number,
): ChatMessage[] {
  if (attempt === 0 || !lastError) return messages;
  const errMsg = lastError instanceof Error ? lastError.message : String(lastError);
  const feedback = [
    ``,
    `[Previous attempt failed validation]`,
    `Error: ${errMsg.slice(0, 600)}`,
    `Fix the issue and output corrected JSON only. Do not include explanations.`,
  ].join("\n");
  // Append to the user message rather than as a new message so the prompt
  // cache prefix (system + start of user) stays warm.
  const last = messages[messages.length - 1];
  if (last.role !== "user") return messages;
  return [
    ...messages.slice(0, -1),
    { ...last, content: `${last.content}\n${feedback}` },
  ];
}
