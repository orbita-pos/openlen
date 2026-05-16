import type { AnyModelId, ImageModelId, TextModelId } from "@/lib/together/models";
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
// When you change pricing or model availability, edit this file and
// `lib/together/models.ts` — nothing else should need touching.
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

export const ROUTING_TABLE: Record<PipelineStep, StepRouting> = {
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
    // Plan needs structured output across many fields. LFM2 fastpath was
    // unreliable in practice (failed validation 5/5 times during wire-up) so
    // we removed it; Kimi K2.6 is the default. Re-enable fastPath once we have
    // a tighter LFM2 plan prompt that validates consistently.
    primary: {
      model: "moonshotai/Kimi-K2.6",
      reason: "Mid-tier reasoning workhorse — best price/quality for section planning.",
    },
    fallbacks: [
      {
        model: "glm-5.1",
        reason: "Heavier reasoning when Kimi's plan misses sections or is shallow.",
      },
    ],
  },
  copy: {
    primary: {
      model: "moonshotai/Kimi-K2.6",
      reason: "Best balance of cost and voice control for long-form section copy.",
    },
    fallbacks: [
      {
        model: "glm-5.1",
        reason: "Switch when Kimi copy reads generic — glm-5.1 handles brand voice better in hard cases.",
      },
    ],
  },
  html: {
    primary: {
      model: "qwen3-coder-480b",
      reason: "Strong code synthesis (480B MoE) — workhorse for HTML/CSS at $2/$2 per M tokens.",
    },
    fallbacks: [
      {
        model: "deepseek-ai/DeepSeek-V4-Pro",
        reason:
          "Hard-fix fallback: 80.6% SWE-bench, 93.5% LiveCodeBench. Trigger when Qwen3-Coder output fails quality gates.",
      },
    ],
  },
  refine: {
    primary: {
      model: "qwen3-235b-tput",
      reason: "Cheap throughput-tier — surgical patches don't need a 480B model.",
    },
    fallbacks: [
      {
        model: "qwen3-coder-480b",
        reason: "Promote to the coder model when the patch is structural, not a string swap.",
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
        "FLUX.2-flex shares the FLUX.2 family aesthetic with the hero and accepts the same 1024×1024 sizing — Wan2.6 was dropped because its 1265-1440 area constraint complicated dimension handling.",
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
  step: PipelineStep;
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
export function fallbackCount(step: PipelineStep): number {
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

type SystemMessageStep = Exclude<PipelineStep, "image_hero" | "image_decorative">;

// Steps that benefit from few-shot examples. classify is a tiny structured-JSON
// task where examples would dilute the schema; refine is a surgical patch step
// that explicitly avoids rewriting structure. The remaining text steps (plan,
// copy, html) all generate creative output that pattern-matches well.
const FEW_SHOT_STEPS = new Set<SystemMessageStep>(["plan", "copy", "html"]);

export function stepNeedsFewShots(step: SystemMessageStep): boolean {
  return FEW_SHOT_STEPS.has(step);
}

export interface SystemMessageContext {
  palette: Palette;
  /**
   * Optionally pre-loaded few-shot examples. When omitted on a step that
   * benefits (see FEW_SHOT_STEPS), the message builder calls loadFewShots()
   * automatically. Pass explicitly when a caller wants deterministic examples
   * (e.g. the regen path, which pins direction to the page's palette).
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

const PLAN_TASK = `TASK: Design the landing-page plan. Choose section sequence, visual direction, and image prompts.

Output a SINGLE JSON object — no markdown, no commentary.

Schema:
{
  "sections": [
    { "id": "<kebab-slug>", "kind": "<hero|features|social_proof|testimonials|pricing|faq|cta|footer>", "purpose": "<one sentence on what this section accomplishes>", "copyDirection": "<one sentence: tone, length, angle>" }
  ],
  "style": {
    "palette": "<mono | dual-accent | vibrant | earthy | neon>",
    "typography": "<modern-sans | editorial-serif | geometric | mono>",
    "density": "<airy | balanced | dense>",
    "mood": "<short evocative phrase>"
  },
  "copyDirection": "<global voice guidance, 1-2 sentences>",
  "imagePrompts": [
    { "id": "<kebab-slug>", "purpose": "<hero|decorative|feature_icon|background>", "prompt": "<concrete compositional prompt — see rules>", "aspectRatio": "<16:9|1:1|4:3|3:4|9:16>" }
  ]
}

Rules for sections:
- Always start with "hero" and end with "footer".
- Pick sections that match the brief. Don't include "pricing" if no pricing is mentioned. Don't include "testimonials" if no quotes are provided.
- Order serves conversion: hero → value → proof → action.
- Section "id" must be unique kebab-case (e.g. "hero", "features-grid", "pricing-tiers", "footer").

Rules for style:
- Match palette/typography to industry + tone. Coffee = earthy + editorial-serif. Developer tool = mono + geometric.

Rules for image prompts (CRITICAL — these go straight to FLUX/Wan):
- Always exactly ONE prompt with purpose="hero" (16:9 aspect).
- 2-3 supporting prompts with purpose in {"decorative","feature_icon","background"}.
- Prompts MUST be compositional, not abstract: subject → composition → lighting → aspect → style cue.
  GOOD: "Bag of single-origin coffee on volcanic black stone, low-angle dramatic lighting, mist rising, cinematic 16:9, editorial photography"
  BAD: "hero image" or "coffee image" or "an image showing the brand"
- Never request text, logos, watermarks, or UI mockups in the image prompt.
- Each prompt 15-40 words.`;

const COPY_TASK = `TASK: Write landing-page copy for the planned sections. Specific, benefit-driven, never generic.

Output a SINGLE JSON object — no markdown, no commentary.

Schema:
{
  "sectionTexts": [
    {
      "sectionId": "<must match a section id from the plan>",
      "headline": <short string, omit if not applicable>,
      "subheadline": <short string, omit if not applicable>,
      "body": <paragraph string, omit if not applicable>,
      "ctas": [{ "label": "<verb-led 1-3 words>", "href": "<#anchor or url>" }],
      "items": [
        { "title": <optional>, "description": <optional>, "meta": { "<key>": "<value>" } }
      ]
    }
  ]
}

PROHIBITED phrases (the master <banned_patterns> list is authoritative; this is the per-step shortlist enforced by the post-generation gate):
- "lorem ipsum", "lorem"
- "awesome", "amazing", "great experience", "world-class", "next-gen", "cutting-edge"
- "powerful platform that empowers"
- "revolutionize", "disrupt", "transform your business"

Rules:
- One section text per planned section. Match sectionId exactly.
- Hero headline: ≤8 words. Concrete noun + concrete verb. Name what the product DOES, not how it FEELS.
  GOOD: "Kanban that auto-prioritizes your sprint"
  BAD: "The most powerful project management for modern teams"
- Subheadlines: 1-2 sentences. Add specificity the headline omits.
- Features: title 3-6 words, description 1-2 sentences each. Each feature must name a specific capability the user gets, not a vague benefit.
- Pricing: tier title + price in meta.price + 1-line description. If brief gives prices, use them verbatim.
- Social proof: prefer concrete logo names or metrics over generic "trusted by thousands".
- Footer: simple — product name, tagline, link items.
- CTAs: action verb. "Start free", "Book demo", "See pricing". Never "Learn more" alone.
- Use the brief's product name and details verbatim where possible. Don't invent features the brief doesn't mention.`;

const COPY_REGEN_TASK = `TASK: Rewrite ONE section of an existing landing page.

Same prohibited-phrase list and voice rules as the full copy step (the master <banned_patterns> and <brand_voice> blocks apply verbatim).

Output a SINGLE JSON object matching one section text — no markdown, no commentary:
{
  "sectionId": "<must match the requested sectionId exactly>",
  "headline": <optional>,
  "subheadline": <optional>,
  "body": <optional>,
  "ctas": [{ "label": "<verb-led>", "href": "<#anchor or url>" }],
  "items": [{ "title": <optional>, "description": <optional>, "meta": { "<k>": "<v>" } }]
}

Rules:
- Stay within the section.kind. A "hero" section gets a headline + subheadline + 1-2 CTAs. A "features" section gets a headline + items. A "pricing" section gets items with meta.price. Don't change the shape.
- Use the rest of the page (other section copy, intent) as context to keep voice consistent.
- If the user provided an additional instruction, follow it strictly. Otherwise just produce a stronger version of the current section.`;

const HTML_TASK = `TASK: Generate production-ready HTML and plain CSS for a single landing page.

Output a SINGLE JSON object — no markdown, no commentary:
{ "html": "<main>...</main>", "css": "..." }

HTML rules:
- Wrap everything in a single <main> element. The FIRST child of <main> is ALWAYS a <header class="navbar"> (page navigation). After it, each planned section is a <section class="<kind>" data-section-id="<id>"> element where <kind> is "hero", "features", "social_proof", etc. matching the plan's section.kind, AND <id> is the EXACT section.id from the plan. The footer is <footer class="footer" data-section-id="<footer-id>"> with the footer section's id from the plan. Both class AND data-section-id are required on every section/footer — the regenerate-section UI uses data-section-id to know which section to re-run.
- The <header class="navbar"> contains three groups: (1) a brand mark on the left — the product name if you can derive one from the hero copy, otherwise a single concrete word from the headline; (2) 3–5 anchor links in the center or right, each href="#<sectionId>" pointing to one of the planned sections (skip "footer" and "hero" — link to features, pricing, faq, social_proof, etc.); (3) a primary CTA button on the far right that mirrors the hero's first CTA label and href. On viewports narrower than 640px hide the center nav links (show just brand + CTA) — DO NOT add hamburger menus or JavaScript toggles.
- Use semantic HTML5: <section>, <article>, <header>, <h1>/<h2>/<h3>, <p>, <ul>/<li>, <a>, <img>.
- The <section class="hero"> (the second child of <main>, after the navbar) MUST contain exactly one <img> with src="{{HERO_IMAGE}}" and a meaningful alt attribute. Assembly swaps the placeholder for a real URL.
- Other image placeholders are src="{{IMG_<id>}}" using an id THAT EXISTS in the plan's imagePrompts list. Each <img> MUST have a non-empty alt attribute.
- NEVER emit <img src=""> or <img src="#">. NEVER reference an image id that is not in imagePrompts. If the copy mentions a logo, brand mark, avatar, or other visual you don't have an imagePrompt for, render it as styled text instead — for example: <span class="logo-pill">Brewdog</span> styled in CSS. This is the rule for client logos, partner marks, team photos, and anything else the brief describes but the plan didn't generate.
- Every <button> or icon-only <a> must have an aria-label.
- All interactive elements use <a href="..."> or <button type="button">. No JS handlers.
- No <script> tags. No external CDN <link> or <script>. No inline event handlers.
- Mobile-first responsive layout. Plan for breakpoints around 640px, 1024px.

CSS rules:
- Plain CSS (NOT Tailwind). Target the classes you set in the HTML. No CSS framework references.
- Use CSS custom properties for the palette (--brand, --bg, --fg, --muted) mapped from the <design_tokens> block above. The palette tokens are normative — do not introduce hex literals not present there.
- Mobile-first: base styles for narrow viewports, @media (min-width: 640px) and (min-width: 1024px) for larger.
- Use modern features: flexbox, grid, clamp() for fluid type, gap for spacing.
- Match the plan's style direction (palette, typography, density, mood).
- Provide hover/focus states on links and buttons for accessibility.
- Reasonable defaults: html { box-sizing: border-box; } *,*:before,*:after { box-sizing: inherit; } body { margin: 0; }.
- The .navbar is position: sticky; top: 0; z-index: 50 with a translucent background and backdrop-filter: blur(8px) so content scrolls underneath it. Comfortable height around 56–64px with horizontal padding matching the rest of the page.

The HTML and CSS together must render a complete, attractive page when injected into a basic HTML document with no other styles.`;

const REFINE_TASK = `TASK: Receive HTML+CSS that has a specific quality-gate failure. Fix ONLY the listed issue and return the corrected payload.

Output a SINGLE JSON object — no markdown, no commentary:
{ "html": "<main>...</main>", "css": "..." }

Strict rules:
- DO NOT change the structure, copy, or styling. Only fix the specific issue listed.
- DO NOT add or remove sections.
- DO NOT introduce new image placeholders or change existing {{HERO_IMAGE}} / {{IMG_<id>}} tokens.
- DO NOT add <script> tags or external <link> resources.
- Preserve all existing class names, ids, and aria attributes.
- The output html must start with <main> and end with </main>.

Common fixes you handle:
- Missing alt attribute on <img> → add a meaningful alt derived from surrounding context.
- Unclosed or unbalanced tag → close it.
- Stray markdown fences (\`\`\`html ... \`\`\`) leaking into output → strip them.
- Trailing commentary after </main> → remove it.
- Missing closing </main> → add it.`;

const TASK_SPECIFIC_PROMPTS: Record<SystemMessageStep, string> = {
  classify: CLASSIFY_TASK,
  plan: PLAN_TASK,
  copy: COPY_TASK,
  html: HTML_TASK,
  refine: REFINE_TASK,
};

export const COPY_REGEN_TASK_PROMPT = COPY_REGEN_TASK;

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
  const taskSpecificAdditions = ctx.extraTaskAdditions
    ? `${baseTask}\n\n${ctx.extraTaskAdditions}`
    : baseTask;

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
