import type { AnyModelId, ImageModelId, TextModelId } from "@/lib/together/models";
import { BLOCK_IDS, BLOCK_REGISTRY } from "@/lib/blocks/_registry";
import type { Intent, PipelineStep, Plan, RoutingDecision } from "./types";
import type { Palette } from "./design-tokens";
import { buildMasterPrompt } from "./master-prompt";
import { loadFewShots, type FewShotExample } from "./few-shots";

// ─────────────────────────────────────────────────────────────────────────────
// Routing table — single source of truth for model selection across the
// pipeline. Pipeline step files NEVER hardcode a model ID; they call
// `pickModel(step, ctx)` which consults this table.
//
// Each entry has:
//   - `primary` model and the reason we picked it
//   - `fallbacks[]` chain in priority order
//   - optional `fastPath` override for the adaptive routing logic
//
// The `assemble` step is deterministic (no LLM) and has no routing entry —
// pickModel will throw if called for it.
// ─────────────────────────────────────────────────────────────────────────────

export interface ModelEntry {
  model: AnyModelId;
  reason: string;
}

export interface StepRouting {
  primary: ModelEntry;
  fallbacks: ModelEntry[];
  /** Optional shortcut for adaptive routing (simple briefs). */
  fastPath?: ModelEntry;
}

// Steps that consult the routing table for a model. `assemble` is excluded
// because it's deterministic React SSR. Keeping this as a derived type means
// adding a new step to PipelineStep + the table is a one-place change.
export type RoutedStep = Exclude<PipelineStep, "assemble">;

export const ROUTING_TABLE: Record<RoutedStep, StepRouting> = {
  classify: {
    primary: {
      model: "lfm2-24b-a2b",
      reason: "Cheap classifier — input/output structure is small and well-typed.",
    },
    fallbacks: [
      {
        model: "moonshotai/Kimi-K2.6",
        reason: "Fallback if lfm2 returns invalid JSON; cached input keeps cost low.",
      },
    ],
  },
  plan: {
    primary: {
      model: "moonshotai/Kimi-K2.6",
      reason:
        "Mid-tier reasoning — best price/quality for picking block IDs from the catalog.",
    },
    fallbacks: [
      {
        model: "glm-5.1",
        reason: "Heavier reasoning when Kimi's block sequence is incoherent or duplicates blocks.",
      },
    ],
  },
  fill: {
    primary: {
      model: "qwen3-235b-tput",
      reason:
        "Throughput-tier model for structured slot JSON — cheap ($0.20/$0.60 per M), fast, JSON-mode reliable. ~$0.0002 per block.",
    },
    fallbacks: [
      {
        model: "moonshotai/Kimi-K2.6",
        reason:
          "Promote to Kimi when Qwen3-235B fails schema validation on a block — bigger model better at coercing constraints.",
      },
    ],
  },
  image_hero: {
    primary: {
      model: "FLUX.2-pro",
      reason: "HD hero imagery with legible text — best of the FLUX.2 family for brand-rich prompts.",
    },
    fallbacks: [
      {
        model: "FLUX.2-flex",
        reason: "Drop to FLUX.2-flex (same price) if pro is busy rather than fail the whole page.",
      },
    ],
  },
  image_decorative: {
    primary: {
      model: "FLUX.2-flex",
      reason:
        "FLUX.2-flex shares the FLUX.2 family aesthetic with the hero and accepts the same 1024×1024 sizing.",
    },
    fallbacks: [],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Adaptive routing — decide if a brief qualifies for the fast path.
// ─────────────────────────────────────────────────────────────────────────────

export function shouldUseFastPath(brief: string, override?: boolean): boolean {
  if (override !== undefined) return override;
  const wordCount = brief.split(/\s+/).filter(Boolean).length;
  if (wordCount > 50) return false;
  // Heuristic: a brief that explicitly mentions sections, pricing tiers, or
  // testimonials is not "simple" even if short.
  if (/pricing|testimonial|enterprise|sso|compliance/i.test(brief)) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolve a model for a step. `pickModel` is what pipeline code calls; it
// emits a `RoutingDecision` that the witness recorder logs verbatim.
// ─────────────────────────────────────────────────────────────────────────────

export interface PickContext {
  step: RoutedStep;
  /** When true, prefer the fastPath entry if defined. */
  fastPath?: boolean;
  /** When provided, force a specific fallback index instead of primary. */
  fallbackIndex?: number;
  /** Optional override reason — used by retry callers. */
  reasonOverride?: string;
}

export function pickModel(ctx: PickContext): RoutingDecision {
  const entry = ROUTING_TABLE[ctx.step];
  if (!entry) {
    throw new Error(`No routing entry for step "${ctx.step}"`);
  }

  if (ctx.fallbackIndex !== undefined) {
    const fallback = entry.fallbacks[ctx.fallbackIndex];
    if (!fallback) {
      throw new Error(
        `No fallback at index ${ctx.fallbackIndex} for step "${ctx.step}"`,
      );
    }
    return {
      step: ctx.step,
      model: fallback.model,
      reason: ctx.reasonOverride ?? fallback.reason,
      isFallback: true,
      fallbackChain: [entry.primary.model, ...entry.fallbacks.slice(0, ctx.fallbackIndex + 1).map((f) => f.model)],
    };
  }

  if (ctx.fastPath && entry.fastPath) {
    return {
      step: ctx.step,
      model: entry.fastPath.model,
      reason: ctx.reasonOverride ?? entry.fastPath.reason,
      isFallback: false,
      fallbackChain: [],
    };
  }

  return {
    step: ctx.step,
    model: entry.primary.model,
    reason: ctx.reasonOverride ?? entry.primary.reason,
    isFallback: false,
    fallbackChain: [],
  };
}

// Convenience accessors with the right ID type for the call site. Pipeline
// code can ask for "give me a text model" or "give me an image model" and the
// type system won't let us cross the streams.

export function pickTextModel(ctx: PickContext): RoutingDecision & {
  model: TextModelId;
} {
  const decision = pickModel(ctx);
  if (decision.step === "image_hero" || decision.step === "image_decorative") {
    throw new Error(`pickTextModel called for image step ${decision.step}`);
  }
  return decision as RoutingDecision & { model: TextModelId };
}

export function pickImageModel(ctx: PickContext): RoutingDecision & {
  model: ImageModelId;
} {
  const decision = pickModel(ctx);
  if (decision.step !== "image_hero" && decision.step !== "image_decorative") {
    throw new Error(`pickImageModel called for text step ${decision.step}`);
  }
  return decision as RoutingDecision & { model: ImageModelId };
}

/** How many fallback models exist for a step. Used by retry loops to know
 *  when to stop attempting fallbacks. */
export function fallbackCount(step: RoutedStep): number {
  return ROUTING_TABLE[step].fallbacks.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// System-message composition.
//
// Every text step builds its system message via `buildSystemMessageForStep`
// instead of hardcoding one. The function injects the master prompt (role +
// quality bar + banned patterns + brand voice + design tokens) and appends a
// terse step-specific addendum that carries the JSON schema and structural
// rules that change per step.
//
// Cacheability: the master prompt depends on `palette.name` and is otherwise
// stable, so once a palette has been observed at least once in a session the
// Together AI prompt cache hits for the full prefix. The brief and plan/copy
// payloads ride in the user message — variable, never cached.
// ─────────────────────────────────────────────────────────────────────────────

type SystemMessageStep = Exclude<RoutedStep, "image_hero" | "image_decorative">;

// Steps that benefit from few-shot examples. classify is a tiny structured-JSON
// task where examples would dilute the schema; fill is a focused per-block
// task with the block's exampleSlots already in the user message. Plan is the
// only remaining text step where reference variants meaningfully steer output.
const FEW_SHOT_STEPS = new Set<SystemMessageStep>(["plan"]);

export function stepNeedsFewShots(step: SystemMessageStep): boolean {
  return FEW_SHOT_STEPS.has(step);
}

export interface SystemMessageContext {
  palette: Palette;
  /**
   * Optionally pre-loaded few-shot examples. When omitted on a step that
   * benefits (see FEW_SHOT_STEPS), the message builder calls loadFewShots()
   * automatically.
   */
  fewShotExamples?: FewShotExample[];
  /** Reserved for callers that want to layer extra task-specific content. */
  extraTaskAdditions?: string;
  /** Available downstream of classify; reserved for future task-specific hints. */
  intent?: Intent;
  /** Available downstream of plan; reserved for future task-specific hints. */
  plan?: Plan;
}

const CLASSIFY_TASK = `TASK: Classify the brief into structured Intent.

Output a SINGLE JSON object — nothing else. No markdown fences, no commentary.

Schema:
{
  "industry": <2-4 word label, e.g. "fintech", "developer tools", "single-origin coffee">,
  "audience": <2-4 word label, e.g. "indie hackers", "freelance designers", "wholesale buyers">,
  "tone": <one of: bold | friendly | professional | playful | minimal | technical>,
  "complexity": <one of: simple | standard | rich>,
  "goals": <array of 2-4 short imperative phrases, e.g. ["drive signups", "communicate technical depth"]>,
  "productName": <string when explicit in brief, omit otherwise>
}

Rules:
- Pick the SINGLE best tone. Default "professional" when ambiguous.
- "complexity" is a length cue: simple = ≤3 sections needed, standard = 4-6, rich = 7+.
- "productName" must appear verbatim in the brief; never invent one.
- Keep labels concrete. "saas" is too generic — prefer "kanban for designers".`;

const PLAN_TASK = `TASK: Design the landing-page plan. Choose an ordered block sequence from the catalog, the aesthetic direction, and the palette.

Output a SINGLE JSON object — no markdown, no commentary.

Schema:
{
  "blockSequence": [
    { "blockId": "<one of the BlockIds listed below>", "purpose": "<one sentence on what this block accomplishes>", "emphasis": "<optional one-sentence override for fill step>" }
  ],
  "aesthetic": "<technical-minimal | refined-editorial | warm-humanist | editorial-maximalist | brutalist-technical>",
  "palette": "<mono-dark | indigo-dark | emerald-dark | warm-dark | mono-light>",
  "rationale": "<1-2 sentences: why this sequence vs alternatives>",
  "imageNeeds": { "hero": <boolean>, "decorative": <integer 0-6> }
}

Rules:
- Pick blocks ONLY from the catalog listed in <available_blocks> below. Any other blockId fails validation.
- The sequence MUST include at least one hero/* block and one footer/* block. A typical sequence is:
  hero/* → features/* → pricing/* (when applicable) → testimonials/* or faq/* (when applicable) → cta/* → footer/*
- Do NOT use the same blockId twice in one page.
- Every chosen block's aesthetics list must include the chosen aesthetic. The catalog below shows each block's aesthetics.
- imageNeeds.hero = true when the chosen hero block has an image slot (mockupSrc/imageSrc/heroImage). It's false for hero/animated-gradient (no image slot).
- imageNeeds.decorative = how many supporting images to generate, max 3. Use 0 for pages whose blocks don't show images.
- rationale is concrete and specific to the brief, not generic ("we picked X because Y").`;

const FILL_TASK = `TASK: Fill slot values for ONE specific block in the planned landing page.

You receive: the block id, the block's purpose on this page, the brief context, and a reference example slot JSON for that block.

Output a SINGLE JSON object — slot values only, matching the example's shape. No markdown, no prose, no commentary.

Rules:
- Copy MUST be specific to the brief — never generic boilerplate.
- Headlines: 4-12 words. Concrete noun + concrete verb. Name what the product DOES.
- Subheadlines: 1-2 sentences with the specificity the headline omits.
- CTAs: imperative verb, ≤4 words ("Start free", "See pricing"). Never "Learn more".
- Eyebrows are nouns, not slogans.
- Pricing items use meta.price verbatim from the brief when given.
- Logos / quotes: use names that look real for the audience. NEVER use lorem ipsum.
- If the example has an image URL (mockupSrc, imageSrc, items[].image.src), leave it as the example value — the assemble step will overwrite it with the FLUX-generated URL.
- Apply the master <banned_patterns> list strictly: no "world-class", "cutting-edge", "revolutionize", "AI-powered" (unless about AI), "next-gen", "transform your business", "leverage", "unlock", "supercharge", or any of the banned headline / layout / icon / code patterns.
- Output ONLY a JSON object. No backticks, no comments.

Failure modes (auto-rejected, will trigger retry):
- Extra fields not in the example shape.
- Missing required fields from the example.
- Banned phrases in any string.
- Markdown fences (\`\`\`json or \`\`\`).`;

const TASK_SPECIFIC_PROMPTS: Record<SystemMessageStep, string> = {
  classify: CLASSIFY_TASK,
  plan: PLAN_TASK,
  fill: FILL_TASK,
};

export function taskAddendumFor(step: SystemMessageStep): string {
  return TASK_SPECIFIC_PROMPTS[step];
}

export interface SystemMessageBuildResult {
  content: string;
  /** Few-shot variants in "direction/variant" form, in the order they were
   *  injected. Empty when the step didn't load any. */
  fewShotVariants: string[];
}

export async function buildSystemMessageForStep(
  step: SystemMessageStep,
  ctx: SystemMessageContext,
): Promise<SystemMessageBuildResult> {
  const baseTask = TASK_SPECIFIC_PROMPTS[step];
  const baseAndExtras = ctx.extraTaskAdditions
    ? `${baseTask}\n\n${ctx.extraTaskAdditions}`
    : baseTask;
  const taskSpecificAdditions =
    step === "plan"
      ? `${baseAndExtras}\n\n${buildAvailableBlocksSection()}`
      : baseAndExtras;

  let fewShots = ctx.fewShotExamples;
  if (fewShots === undefined && stepNeedsFewShots(step)) {
    // Prefer the first aesthetic direction the palette suggests so the closest
    // reference is listed first per Lost-in-the-Middle.
    const preferredDirection = ctx.palette.aestheticDirections[0];
    fewShots = await loadFewShots({ preferredDirection });
  }

  const examples = fewShots ?? [];
  const content = buildMasterPrompt({
    palette: ctx.palette,
    fewShotExamples: examples,
    taskSpecificAdditions,
  });
  return {
    content,
    fewShotVariants: examples.map((ex) => `${ex.direction}/${ex.variant}`),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Catalog injection for the plan step. Reads the live registry so the
// prompt's allowed blockIds always match what the assemble step can render.
// ─────────────────────────────────────────────────────────────────────────────

function buildAvailableBlocksSection(): string {
  const lines: string[] = ["<available_blocks>"];
  for (const id of BLOCK_IDS) {
    const { meta } = BLOCK_REGISTRY[id];
    lines.push(
      `- ${id} — ${meta.description} (aesthetics: ${meta.aesthetics.join(", ")})`,
    );
  }
  lines.push("</available_blocks>");
  return lines.join("\n");
}
