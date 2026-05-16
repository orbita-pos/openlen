import type { ChatMessage } from "@/lib/together/client";
import { PlanSchema } from "./types";
import type { Intent, Plan } from "./types";
import { parseJson, runTextStep, type StepContext } from "./_shared";

const SYSTEM_PROMPT = `You are a senior product designer planning a landing page.
Given the structured intent below, design a sequence of sections, choose a visual style direction, and write image prompts for the hero plus 2-4 supporting visuals.
Sections must be ordered top to bottom. Choose from: hero, features, social_proof, testimonials, pricing, faq, cta, footer.
Return ONLY valid JSON matching the schema (no commentary):
{
  "sections": [{ "id": "<slug>", "kind": "<one of the section kinds>", "purpose": "<plain language>", "copyDirection": "<plain language>" }],
  "style": {
    "palette": "<mono | dual-accent | vibrant | earthy | neon>",
    "typography": "<modern-sans | editorial-serif | geometric | mono>",
    "density": "<airy | balanced | dense>",
    "mood": "<short string>"
  },
  "copyDirection": "<global voice guidance>",
  "imagePrompts": [{ "id": "<slug>", "purpose": "<hero | decorative | feature_icon | background>", "prompt": "<concrete prompt with no text request>", "aspectRatio": "<16:9 | 1:1 | 4:3 | 3:4 | 9:16>" }]
}`;

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
    callOptions: { responseFormat: "json", temperature: 0.6, maxTokens: 2048 },
    progressDetail: ctx.fastPath
      ? "Adaptive fast-path planning (simple brief)"
      : "Designing section sequence and visual direction",
    validate: (content) => {
      const parsed = parseJson<unknown>(content, "plan");
      return PlanSchema.parse(parsed);
    },
  });
}
