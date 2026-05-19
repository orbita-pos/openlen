// Template + business data → filled HTML via Kimi K2.6 with ID-tagged ops.
// Streaming-capable: callers can pass onChunk to receive deltas as they
// arrive (used by the API route to forward SSE events to the client).

import { applyOps, parseOps, stripOpIds, tagWithOpIds } from "@/lib/html-ops";
import type { ExtractedBusinessData } from "./types";

const TOGETHER_ENDPOINT = "https://api.together.xyz/v1/chat/completions";
const MODEL_ID = "moonshotai/Kimi-K2.6";
const MAX_TOKENS = 16_000;
const TEMPERATURE = 0.6;
const SUCCESS_THRESHOLD = 0.8;

export const FILL_SYSTEM_PROMPT = `You are filling a generic landing page template with a real business's specific data. Your job is to replace generic placeholder copy with the user's actual business details — surgically, at the leaf level. You do NOT redesign, restructure, or restyle the page.

═══════════════════════════════════════════
CRITICAL — TARGET DISCIPLINE (read this twice)
═══════════════════════════════════════════

You emit op="replace" ONLY on LEAF text-bearing elements:
  ✅ ALLOWED replace targets (tag must be one of):
     h1, h2, h3, h4, h5, h6, p, span, li, a, button, label, blockquote, em, strong, time, small, dt, dd, td, th, figcaption, summary

  ❌ FORBIDDEN replace targets (NEVER replace these — they contain children):
     html, head, body, main, section, header, footer, article, nav, aside, form, div, ul, ol, dl, table, tr, picture, figure

  Why: replacing a container DELETES all its children. The template has hundreds of tagged elements, most of which are leaves nested inside containers. If you replace a container, every child id becomes invalid and every subsequent op fails.

For containers you want REMOVED (a whole section the business doesn't need), use:
  <edit op="delete" target="<container-id>" />

NEVER use op="replace" on a container. Either leave it alone or delete it.

═══════════════════════════════════════════
PROTOCOL — ID-tagged ops
═══════════════════════════════════════════

<edit op="replace" target="<id-of-LEAF-element>"><new-element-html /></edit>
<edit op="delete" target="<id-of-container-or-leaf>" />

When you replace a leaf, the <new> content should be just the leaf element itself with new text inside. Example for an h1:
  GOOD: <edit op="replace" target="q"><new><h1 class="display mt-6">Tacos de Juan — Auténticos al pastor desde 1989</h1></new></edit>
  BAD:  <edit op="replace" target="0"><new><body>...whole body...</body></new></edit>  ← never replace body
  BAD:  <edit op="replace" target="q"><new><h1 data-op-id="q" class="display">...</h1></new></edit>  ← never include data-op-id

NEVER include data-op-id="..." in the HTML you emit. The server strips them; you don't need them.
NEVER include data-slot-path anywhere (reserved editor marker).

═══════════════════════════════════════════
WHAT TO FILL — sparse-data discipline
═══════════════════════════════════════════

CORE RULE: **only replace template text with data the user actually provided.** If a user-data field is null, empty, or missing, LEAVE THE TEMPLATE'S ORIGINAL COPY IN PLACE — do NOT emit a replace op for that slot, and do NOT invent fictional copy.

Specifically:
- features array empty → don't touch feature sections; leave the template's generic feature copy intact
- pricing array empty → don't touch pricing sections
- testimonials array empty → don't touch testimonial sections
- faq_questions array empty → don't touch FAQ
- cta_secondary null → leave the secondary CTA's original text
- tagline_es / tagline_en null → don't replace the hero subheading

The user gets a partial fill (what they have data for) with the rest of the template untouched. THIS IS THE GOAL. Sparse data should result in FEWER ops, not more.

CTAs: replace ONLY if user provided cta_primary or cta_secondary. Don't translate or rewrite existing CTAs if the user didn't give you a replacement.

Match user's business data to contextually appropriate text slots:
- business_name → first wordmark / logo text in nav + footer
- tagline (es or en based on user's language) → hero subheading
- pitch → hero subheading paragraph (if there's one BELOW the h1)
- hero_keyword → spans a single word in the hero h1 with the template's accent class (look at the template's existing accent span pattern, reuse the same classes)
- features[] → feature card titles + descriptions, 1:1 mapping; if user has 4 features but template has 6 cards, only fill the first 4
- pricing[] → pricing tier names + prices + bullet lists; if user has 2 tiers but template has 3, delete the 3rd tier container via op="delete"
- testimonials[] → testimonial quotes + author lines; 1:1 mapping with cap at template count
- faq_questions[] → FAQ Q + A pairs; same 1:1 with cap

PRESERVE the LANGUAGE the user is using (Spanish vs English vs Portuguese, based on language_detected or which tagline field is filled). Do NOT translate the template's original copy that you DON'T replace.

═══════════════════════════════════════════
COPY LENGTH BUDGET — strict per element type
═══════════════════════════════════════════

The template was designed at certain font sizes for certain copy lengths. If you fill a 72px display heading with 60 chars of copy, it wraps to 3 lines and breaks the hero. Match the EXPECTED length per slot:

- HERO h1 (biggest heading on the page): 6-12 WORDS MAXIMUM. PUNCHY. If user data has a longer tagline, EXTRACT THE ESSENCE into a short version.
- HERO sub-paragraph (the <p> right under the h1): 15-25 words, ONE sentence. The longer user-provided "pitch" can go here.
- Section headings (h2/h3): 2-6 words. Topic-name level.
- Feature card titles (h3 inside cards): 2-5 words.
- Feature card descriptions (p inside cards): 15-30 words, 1-2 sentences max.
- Pricing tier names: 1-2 words ("Free", "Pro", "Team").
- Pricing tier features (bullet list items): 3-6 words each.
- Testimonial quotes: 1-2 sentences (15-30 words).
- Testimonial author lines: "Name · Role · Company" max.
- FAQ questions: 4-10 words, ending in "?".
- FAQ answers: 1-2 sentences.
- Button labels / CTAs: 1-4 words.
- Footer copy: ultra-compact, label-style.

If user data has more detail than fits the slot, COMPRESS to the slot's budget. Don't try to fit everything verbatim.

═══════════════════════════════════════════
OUTPUT BUDGET
═══════════════════════════════════════════

- CAP at 64 ops total. Hard cap.
- Prioritize PROMINENCE: hero > main features > pricing > CTAs > testimonials > FAQ > footer.

═══════════════════════════════════════════
QUALITY BAR
═══════════════════════════════════════════

The output should read like the template was DESIGNED FOR this specific business — real numbers, real prices, real names, specific details. No Lorem Ipsum residue. No generic SaaS phrases. No truncation-prone long-form copy in slots designed for punchy text.

Output ONLY the <edits>...</edits> block. No preamble. No markdown fences. No commentary.`;

export function buildFillUserMessage(
  data: unknown,
  taggedHtml: string,
): string {
  return `Fill this landing page template with the business data below.

═══════════════════════════════════════════
BUSINESS DATA (JSON):
═══════════════════════════════════════════

${JSON.stringify(data, null, 2)}

═══════════════════════════════════════════
TEMPLATE HTML (every interesting element has a data-op-id attribute):
═══════════════════════════════════════════

${taggedHtml}

═══════════════════════════════════════════

Emit your <edits>...</edits> block now. Replace ONLY the template's generic copy with this business's actual data. For any user-data field that's null or empty, leave the template's original copy intact. Preserve the design 100% — only swap visible text on LEAF elements. Match the business's language throughout.`;
}

export interface FillTemplateInput {
  /** The HTML to fill. Will be tagged with data-op-id internally; do NOT pre-tag. */
  sourceHtml: string;
  /** Business data (extracted from image or provided directly). */
  data: ExtractedBusinessData | Record<string, unknown>;
  /** Optional callback fired for each streamed delta from Kimi. */
  onChunk?: (cumulativeBytes: number) => void;
  /** Optional progress callback for stages. */
  onStage?: (stage: "tagging" | "calling-model" | "applying") => void;
  signal?: AbortSignal;
}

export interface FillTemplateOk {
  ok: true;
  filledHtml: string;
  appliedOps: number;
  totalOps: number;
  cascadeErrors: number;
  finishReason: string | null;
  usage?: { inputTokens: number; outputTokens: number };
  durationMs: number;
  rawResponse: string;
}

export interface FillTemplateErr {
  ok: false;
  error: {
    kind:
      | "missing-key"
      | "api"
      | "empty-html"
      | "parse"
      | "empty-ops"
      | "apply"
      | "low-success-rate"
      | "aborted";
    message: string;
  };
  rawResponse?: string;
  partialHtml?: string;
  appliedOps?: number;
  totalOps?: number;
  durationMs: number;
}

export type FillTemplateResult = FillTemplateOk | FillTemplateErr;

export async function fillTemplate(
  input: FillTemplateInput,
): Promise<FillTemplateResult> {
  const t0 = Date.now();
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error: {
        kind: "missing-key",
        message: "TOGETHER_API_KEY not set",
      },
      durationMs: Date.now() - t0,
    };
  }
  if (!/<html[\s>]/i.test(input.sourceHtml) || !/<\/html>/i.test(input.sourceHtml)) {
    return {
      ok: false,
      error: { kind: "empty-html", message: "sourceHtml must be a full HTML document" },
      durationMs: Date.now() - t0,
    };
  }

  input.onStage?.("tagging");
  const { taggedHtml, taggedCount } = tagWithOpIds(input.sourceHtml);
  if (taggedCount === 0) {
    return {
      ok: false,
      error: { kind: "empty-html", message: "No taggable elements in HTML" },
      durationMs: Date.now() - t0,
    };
  }

  input.onStage?.("calling-model");
  const messages = [
    { role: "system" as const, content: FILL_SYSTEM_PROMPT },
    {
      role: "user" as const,
      content: buildFillUserMessage(input.data, taggedHtml),
    },
  ];

  let response: Response;
  try {
    response = await fetch(TOGETHER_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL_ID,
        messages,
        temperature: TEMPERATURE,
        max_tokens: MAX_TOKENS,
        stream: true,
        enable_thinking: false,
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: input.signal,
    });
  } catch (err) {
    if (input.signal?.aborted) {
      return {
        ok: false,
        error: { kind: "aborted", message: "Request aborted" },
        durationMs: Date.now() - t0,
      };
    }
    return {
      ok: false,
      error: {
        kind: "api",
        message: err instanceof Error ? err.message : String(err),
      },
      durationMs: Date.now() - t0,
    };
  }
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    return {
      ok: false,
      error: {
        kind: "api",
        message: `Together ${response.status}: ${text.slice(0, 400)}`,
      },
      durationMs: Date.now() - t0,
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let sseBuf = "";
  let accumulated = "";
  let usage: { inputTokens: number; outputTokens: number } | undefined;
  let finishReason: string | null = null;
  let upstreamDone = false;

  while (!upstreamDone) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (err) {
      if (input.signal?.aborted) {
        return {
          ok: false,
          error: { kind: "aborted", message: "Stream aborted" },
          durationMs: Date.now() - t0,
        };
      }
      return {
        ok: false,
        error: {
          kind: "api",
          message: err instanceof Error ? err.message : String(err),
        },
        durationMs: Date.now() - t0,
      };
    }
    if (chunk.done) break;
    sseBuf += decoder.decode(chunk.value, { stream: true });
    let nl: number;
    while ((nl = sseBuf.indexOf("\n\n")) >= 0) {
      const block = sseBuf.slice(0, nl);
      sseBuf = sseBuf.slice(nl + 2);
      for (const line of block.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") {
          upstreamDone = true;
          break;
        }
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{
              delta?: { content?: string };
              finish_reason?: string | null;
            }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          const c = parsed.choices?.[0];
          if (c?.finish_reason) finishReason = c.finish_reason;
          const content = c?.delta?.content;
          if (typeof content === "string" && content.length > 0) {
            accumulated += content;
            input.onChunk?.(accumulated.length);
          }
          if (parsed.usage) {
            usage = {
              inputTokens: parsed.usage.prompt_tokens ?? 0,
              outputTokens: parsed.usage.completion_tokens ?? 0,
            };
          }
        } catch {
          /* swallow malformed SSE line */
        }
      }
    }
  }

  input.onStage?.("applying");
  const { ops, errors: parseErrors } = parseOps(accumulated);
  if (parseErrors.length > 0 && ops.length === 0) {
    return {
      ok: false,
      error: {
        kind: "parse",
        message: `Couldn't parse ops: ${parseErrors[0]}${finishReason === "length" ? " (response hit token cap)" : ""}`,
      },
      rawResponse: accumulated,
      durationMs: Date.now() - t0,
    };
  }
  if (ops.length === 0) {
    return {
      ok: false,
      error: {
        kind: "empty-ops",
        message: "Model returned no operations.",
      },
      rawResponse: accumulated,
      durationMs: Date.now() - t0,
    };
  }

  const applyResult = applyOps(taggedHtml, ops);
  if (!applyResult.html) {
    return {
      ok: false,
      error: {
        kind: "apply",
        message: applyResult.errors[0]?.reason ?? "Apply produced no HTML",
      },
      rawResponse: accumulated,
      appliedOps: applyResult.appliedCount,
      totalOps: ops.length,
      durationMs: Date.now() - t0,
    };
  }

  const successRate = applyResult.appliedCount / ops.length;
  if (successRate < SUCCESS_THRESHOLD) {
    return {
      ok: false,
      error: {
        kind: "low-success-rate",
        message: `Only ${(successRate * 100).toFixed(0)}% of ${ops.length} ops applied — below ${SUCCESS_THRESHOLD * 100}% threshold.`,
      },
      rawResponse: accumulated,
      partialHtml: stripOpIds(applyResult.html),
      appliedOps: applyResult.appliedCount,
      totalOps: ops.length,
      durationMs: Date.now() - t0,
    };
  }

  const cleanHtml = stripOpIds(applyResult.html);
  return {
    ok: true,
    filledHtml: cleanHtml,
    appliedOps: applyResult.appliedCount,
    totalOps: ops.length,
    cascadeErrors: applyResult.errors.length,
    finishReason,
    usage,
    durationMs: Date.now() - t0,
    rawResponse: accumulated,
  };
}
