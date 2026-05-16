import type { ChatMessage } from "@/lib/together/client";
import { IntentSchema } from "./types";
import type { Intent } from "./types";
import { parseJson, runTextStep, type StepContext } from "./_shared";

const SYSTEM_PROMPT = `You are an intent classifier for a landing-page generator.
Read the user's brief and emit a strict JSON object describing the page's industry, target audience, voice/tone, complexity level, top goals, and any product name explicitly mentioned.
Return ONLY valid JSON with this shape (no commentary, no markdown fences):
{
  "industry": "<short label>",
  "audience": "<short label>",
  "tone": "<one of: bold | friendly | professional | playful | minimal | technical>",
  "complexity": "<one of: simple | standard | rich>",
  "goals": ["<short goal>", ...],
  "productName": "<string or omit>"
}`;

function buildMessages(brief: string): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT, cache: true },
    { role: "user", content: brief },
  ];
}

export async function classify(ctx: StepContext): Promise<Intent> {
  return runTextStep<Intent>(ctx, {
    step: "classify",
    buildMessages: () => buildMessages(ctx.brief),
    mockKey: "classify",
    callOptions: { responseFormat: "json", temperature: 0.1, maxTokens: 512 },
    progressDetail: "Parsing brief into structured intent",
    validate: (content) => {
      const parsed = parseJson<unknown>(content, "classify");
      return IntentSchema.parse(parsed);
    },
  });
}
