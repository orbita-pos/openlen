import { z } from "zod";
import type { ChatMessage } from "@/lib/together/client";
import { completeText } from "@/lib/together/client";
import { pickTextModel } from "./routing";
import type { HtmlOutput } from "./html";
import { emit, parseJson, type StepContext } from "./_shared";

// ─────────────────────────────────────────────────────────────────────────────
// Refine step.
//
// Last-resort recovery for the html step. When both Qwen3-Coder-Next and
// DeepSeek V4 Pro produce HTML that fails the quality gates, refine takes the
// FAILING html + the specific issue and asks Qwen3.5-9B to patch it. This is
// cheap (~$0.001 per call) and surprisingly effective for narrow fixes like
// missing alt attributes, unbalanced tags, or stray markdown fences.
//
// NOT a creative pass — refine never rewrites copy or restructures sections.
// It only fixes the listed issue while preserving the rest of the document.
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You receive HTML+CSS that has a specific quality-gate failure. Fix ONLY the listed issue and return the corrected payload.

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

const HtmlOutputSchema = z.object({
  html: z.string().min(50),
  css: z.string().min(20),
});

function buildMessages(prevContent: string, issue: string): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT, cache: true },
    {
      role: "user",
      content: `Issue to fix: ${issue}\n\nCurrent payload (raw model output, may include the JSON wrapper):\n${prevContent}`,
    },
  ];
}

/**
 * Run refine on a failing html-step output. Returns a fixed `HtmlOutput` or
 * throws if even the patch model can't produce valid output.
 *
 * Wired in `html.ts` via `runTextStep`'s `lastResort` hook.
 */
export async function refineHtml(
  ctx: StepContext,
  prevContent: string,
  prevError: Error,
): Promise<HtmlOutput> {
  emit(ctx, {
    type: "progress",
    step: "refine",
    status: "started",
    details: `Refining HTML to fix: ${prevError.message}`,
  });

  const decision = pickTextModel({ step: "refine" });
  ctx.budget.guard();

  const result = await completeText({
    model: decision.model,
    messages: buildMessages(prevContent, prevError.message),
    responseFormat: "json",
    temperature: 0.2,
    maxTokens: 8192,
  });

  await ctx.recorder.record({
    step: "refine",
    decision,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    latencyMs: result.latencyMs,
    costUsd: result.costUsd,
    mocked: result.mocked,
    note: `recovery from html: ${prevError.message.slice(0, 120)}`,
  });
  ctx.budget.add("refine", result.costUsd);

  const parsed = parseJson<unknown>(result.content, "refine");
  const out = HtmlOutputSchema.parse(parsed);

  emit(ctx, {
    type: "progress",
    step: "refine",
    status: "completed",
    details: "HTML refined",
    costSoFar: ctx.budget.total(),
  });

  return out;
}
