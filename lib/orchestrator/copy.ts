import type { ChatMessage } from "@/lib/together/client";
import { CopySchema } from "./types";
import type { Copy, Plan } from "./types";
import { parseJson, runTextStep, type StepContext } from "./_shared";

const SYSTEM_PROMPT = `You are writing landing-page copy.
For each planned section, produce concrete headline, subheadline, body text, CTA labels, and item lists where appropriate.
Follow the section's copyDirection. Voice should be specific and concrete — name verbs, name nouns, avoid filler like "powerful platform that empowers teams to ...".
Return ONLY valid JSON:
{
  "sectionTexts": [{
    "sectionId": "<id matching the plan>",
    "headline": "<string or omit>",
    "subheadline": "<string or omit>",
    "body": "<string or omit>",
    "ctas": [{ "label": "<verb-led>", "href": "#anchor-or-url" }],
    "items": [{ "title": "<optional>", "description": "<optional>", "meta": { "<k>": "<v>" } }]
  }]
}`;

function buildMessages(brief: string, plan: Plan): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT, cache: true },
    {
      role: "user",
      content: `Brief:\n${brief}\n\nPlan JSON:\n${JSON.stringify(plan, null, 2)}`,
    },
  ];
}

export async function generateCopy(
  ctx: StepContext,
  plan: Plan,
): Promise<Copy> {
  return runTextStep<Copy>(ctx, {
    step: "copy",
    buildMessages: () => buildMessages(ctx.brief, plan),
    mockKey: "copy",
    callOptions: { responseFormat: "json", temperature: 0.8, maxTokens: 4096 },
    progressDetail: "Writing copy for each section",
    validate: (content) => {
      const parsed = parseJson<unknown>(content, "copy");
      const copy = CopySchema.parse(parsed);
      // Quality gate: every planned section must have copy.
      const missing = plan.sections.filter(
        (s) => !copy.sectionTexts.some((c) => c.sectionId === s.id),
      );
      if (missing.length > 0) {
        throw new Error(
          `copy: missing text for sections [${missing.map((s) => s.id).join(", ")}]`,
        );
      }
      return copy;
    },
  });
}
