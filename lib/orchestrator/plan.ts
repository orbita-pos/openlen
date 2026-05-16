import type { ChatMessage } from "@/lib/together/client";
import { BLOCK_IDS, BLOCK_REGISTRY, isBlockId } from "@/lib/blocks/_registry";
import type { BlockId } from "@/lib/blocks/_registry";
import { PlanSchema } from "./types";
import type { Intent, Plan } from "./types";
import { parseJson, runTextStep, type StepContext } from "./_shared";
import { buildSystemMessageForStep } from "./routing";

// ─────────────────────────────────────────────────────────────────────────────
// Plan step.
//
// The plan step's only job in the slot-filling pipeline is to pick an ordered
// sequence of block IDs from the catalog (lib/blocks/_registry.ts) and commit
// to an aesthetic direction + palette. It produces NO section markup, NO copy,
// NO HTML. Per-block slot JSON comes from the `fill` step.
//
// Output validation is two-step:
//   1. PlanSchema.parse() — catches missing fields, wrong types.
//   2. Custom checks — at least one hero, one footer; no duplicate block IDs;
//      all block IDs match an entry in the registry.
// Failing either throws, which triggers the routing fallback (glm-5.1) and
// finally a deterministic fallback to a canonical 5-block sequence so the
// page always renders something useful.
// ─────────────────────────────────────────────────────────────────────────────

export async function plan(ctx: StepContext, intent: Intent): Promise<Plan> {
  const system = await buildSystemMessageForStep("plan", {
    palette: ctx.palette,
    intent,
  });
  const buildMessages = (): ChatMessage[] => [
    { role: "system", content: system.content, cache: true },
    {
      role: "user",
      content: `Brief:\n${ctx.brief}\n\nIntent JSON:\n${JSON.stringify(intent, null, 2)}`,
    },
  ];

  try {
    return await runTextStep<Plan>(ctx, {
      step: "plan",
      buildMessages,
      mockKey: "plan",
      useFastPath: ctx.fastPath,
      callOptions: { responseFormat: "json", temperature: 0.4, maxTokens: 2048 },
      progressDetail: ctx.fastPath
        ? "Adaptive fast-path planning (simple brief)"
        : "Designing block sequence and visual direction",
      fewShotVariants: system.fewShotVariants,
      validate: (content) => {
        const parsed = parseJson<unknown>(content, "plan");
        const planResult = PlanSchema.parse(parsed);
        return validatePlanShape(planResult);
      },
    });
  } catch (err) {
    // Deterministic last-resort fallback: a canonical sequence keyed by the
    // pre-classify palette's preferred aesthetic. The page still renders even
    // if every model call returned junk; a witness record is already on disk
    // for the failed attempts.
    const fallback = canonicalFallbackPlan(ctx, intent, err);
    return fallback;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan shape validation. Runs after PlanSchema.parse — these are semantic
// gates that wouldn't naturally fall out of the Zod schema.
// ─────────────────────────────────────────────────────────────────────────────

function validatePlanShape(p: Plan): Plan {
  const ids = p.blockSequence.map((e) => e.blockId);

  // Every block id must exist in the registry (BlockIdSchema's refine() handles
  // this at parse time, but re-asserting here gives a clearer error if the
  // refine ever changes).
  const unknown = ids.filter((id) => !isBlockId(id));
  if (unknown.length > 0) {
    throw new Error(
      `plan: unknown block ids: ${unknown.join(", ")}. Allowed: ${BLOCK_IDS.join(", ")}`,
    );
  }

  // Hero & footer must both be present.
  const hasHero = ids.some((id) => id.startsWith("hero/"));
  const hasFooter = ids.some((id) => id.startsWith("footer/"));
  if (!hasHero) {
    throw new Error("plan: blockSequence missing a hero/* block");
  }
  if (!hasFooter) {
    throw new Error("plan: blockSequence missing a footer/* block");
  }

  // No duplicate block IDs — repeating a block on the same page looks
  // amateurish and is almost always a hallucination ("two heroes?").
  const seen = new Set<string>();
  const dups: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) dups.push(id);
    seen.add(id);
  }
  if (dups.length > 0) {
    throw new Error(`plan: duplicate block ids: ${dups.join(", ")}`);
  }

  // Every chosen block's aesthetics list must include the picked aesthetic.
  // Otherwise the block will render in a style mismatched to the rest of
  // the page (e.g. a brutalist-only block on a warm-humanist page).
  const mismatched = p.blockSequence.filter(
    (e) => !BLOCK_REGISTRY[e.blockId].meta.aesthetics.includes(p.aesthetic),
  );
  if (mismatched.length > 0) {
    throw new Error(
      `plan: ${mismatched.length} block(s) don't fit aesthetic "${p.aesthetic}": ${mismatched
        .map((m) => m.blockId)
        .join(", ")}`,
    );
  }

  return p;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic fallback. Picks a generic 5-block sequence using the palette's
// first aesthetic direction. Every block here is `aesthetics.includes(*every
// direction)` so the fallback is safe regardless of which palette was chosen.
// ─────────────────────────────────────────────────────────────────────────────

const UNIVERSAL_SAFE_SEQUENCE: BlockId[] = [
  "hero/split-image",
  "features/icon-grid-3col",
  "pricing/three-tier-highlight",
  "cta/gradient-cta",
  "footer/four-col-links",
];

function canonicalFallbackPlan(
  ctx: StepContext,
  intent: Intent,
  err: unknown,
): Plan {
  const aesthetic = ctx.palette.aestheticDirections[0];
  const message = err instanceof Error ? err.message : String(err);
  // Note: this is intentionally minimal — the goal is "page renders something
  // reasonable" not "page is great". A witness record for the failed model
  // calls is already on disk; this fallback doesn't add its own record.
  return {
    blockSequence: UNIVERSAL_SAFE_SEQUENCE.map((blockId, idx) => ({
      blockId,
      purpose: defaultPurposeFor(blockId, intent),
      emphasis: idx === 0 ? "hero must be specific to the brief" : undefined,
    })),
    aesthetic,
    palette: ctx.palette.name,
    rationale: `Fallback sequence after plan step failed: ${message.slice(0, 200)}`,
    imageNeeds: { hero: true, decorative: 0 },
  };
}

function defaultPurposeFor(blockId: BlockId, intent: Intent): string {
  if (blockId.startsWith("hero/")) {
    return `Anchor the brand promise for ${intent.industry} aimed at ${intent.audience}.`;
  }
  if (blockId.startsWith("features/")) {
    return "Three concrete capabilities that differentiate this product.";
  }
  if (blockId.startsWith("pricing/")) {
    return "Two or three tiers with clear differentiation.";
  }
  if (blockId.startsWith("cta/")) {
    return "Final push to convert with one strong action.";
  }
  if (blockId.startsWith("footer/")) {
    return "Standard site footer with links and brand mark.";
  }
  if (blockId.startsWith("testimonials/")) {
    return "Social proof from real-feeling users in the target audience.";
  }
  if (blockId.startsWith("faq/")) {
    return "Address the top 3-5 objections that block conversion.";
  }
  return "Section.";
}
