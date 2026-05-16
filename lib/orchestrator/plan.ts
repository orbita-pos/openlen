import type { ChatMessage } from "@/lib/together/client";
import { PlanSchema } from "./types";
import type { Intent, Plan } from "./types";
import { parseJson, runTextStep, type StepContext } from "./_shared";

const SYSTEM_PROMPT = `You design landing-page plans. Given a brief and structured intent, you choose:
1. Section sequence (top to bottom)
2. Visual direction (palette, typography, density, mood)
3. Image prompts for hero + 2-3 supporting visuals

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

function buildMessages(brief: string, intent: Intent): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT, cache: true },
    {
      role: "user",
      content: `Brief:\n${brief}\n\nIntent JSON:\n${JSON.stringify(intent, null, 2)}`,
    },
  ];
}

export async function plan(ctx: StepContext, intent: Intent): Promise<Plan> {
  return runTextStep<Plan>(ctx, {
    step: "plan",
    buildMessages: () => buildMessages(ctx.brief, intent),
    mockKey: "plan",
    useFastPath: ctx.fastPath,
    callOptions: { responseFormat: "json", temperature: 0.4, maxTokens: 2048 },
    progressDetail: ctx.fastPath
      ? "Adaptive fast-path planning (simple brief)"
      : "Designing section sequence and visual direction",
    validate: (content) => {
      const parsed = parseJson<unknown>(content, "plan");
      const plan = PlanSchema.parse(parsed);
      // Quality gate: must have a hero image prompt and at least one section.
      const hasHero = plan.imagePrompts.some((p) => p.purpose === "hero");
      if (!hasHero) {
        throw new Error("plan: imagePrompts missing a hero entry");
      }
      const heroSection = plan.sections.find((s) => s.kind === "hero");
      if (!heroSection) {
        throw new Error("plan: sections missing a hero entry");
      }
      return plan;
    },
  });
}
