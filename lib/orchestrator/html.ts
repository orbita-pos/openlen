import { z } from "zod";
import type { ChatMessage } from "@/lib/together/client";
import type { Copy, Plan } from "./types";
import { parseJson, runTextStep, type StepContext } from "./_shared";

const SYSTEM_PROMPT = `You are generating production-ready HTML and CSS for a single landing page.
- Output a JSON object: { "html": "<main>...</main>", "css": "..." }.
- The HTML must be a single <main> element containing the sections, in order.
- The CSS is a string of plain CSS targeting the classes you use. No CSS frameworks. No inline styles.
- Use semantic HTML (section, article, h1/h2/h3, p, ul/li, footer).
- Where an image is needed, use src="{{HERO_IMAGE}}" or src="{{IMG_<id>}}" placeholders. Assembly stage will swap in real URLs.
- Apply the style direction: palette, typography, density, mood.
- Make it responsive. Mobile first. No JS.
Return ONLY the JSON.`;

const HtmlOutputSchema = z.object({
  html: z.string().min(50),
  css: z.string().min(20),
});

export interface HtmlOutput {
  html: string;
  css: string;
}

function buildMessages(plan: Plan, copy: Copy): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT, cache: true },
    {
      role: "user",
      content: `Plan JSON:\n${JSON.stringify(plan, null, 2)}\n\nCopy JSON:\n${JSON.stringify(copy, null, 2)}`,
    },
  ];
}

export async function generateHtml(
  ctx: StepContext,
  plan: Plan,
  copy: Copy,
): Promise<HtmlOutput> {
  return runTextStep<HtmlOutput>(ctx, {
    step: "html",
    buildMessages: () => buildMessages(plan, copy),
    mockKey: "html",
    callOptions: { responseFormat: "json", temperature: 0.4, maxTokens: 6144 },
    progressDetail: "Generating HTML and CSS",
    fallbackNote:
      "Quality gate failed on primary HTML output; escalating to DeepSeek V4 Pro for a hard fix.",
    validate: (content) => {
      const parsed = parseJson<unknown>(content, "html");
      const out = HtmlOutputSchema.parse(parsed);
      // Quality gate: rough HTML well-formedness — balanced tags + a closing
      // </main>. This is cheap, not perfect, but catches the failure modes
      // that justify a fallback (truncation, JSON-escape leakage).
      assertWellFormed(out.html);
      return out;
    },
  });
}

function assertWellFormed(html: string): void {
  if (!/<\/main>\s*$/.test(html.trim())) {
    throw new Error("html: missing closing </main>");
  }
  // Count opening vs closing tags (ignoring void elements) — rough heuristic.
  const open = (html.match(/<([a-z][a-z0-9]*)(\s[^>]*)?>/gi) ?? []).filter(
    (t) => !/<(br|hr|img|input|meta|link|source|wbr)\b/i.test(t),
  ).length;
  const close = (html.match(/<\/[a-z][a-z0-9]*>/gi) ?? []).length;
  if (Math.abs(open - close) > 2) {
    throw new Error(
      `html: tag balance off (${open} open vs ${close} close) — likely truncated`,
    );
  }
}
