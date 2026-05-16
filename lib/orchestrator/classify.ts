import type { ChatMessage } from "@/lib/together/client";
import { IntentSchema } from "./types";
import type { Intent } from "./types";
import { parseJson, runTextStep, type StepContext } from "./_shared";

const SYSTEM_PROMPT = `You classify briefs for a landing-page generator into structured intent.

Output a single JSON object — nothing else. No markdown fences, no commentary.

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
