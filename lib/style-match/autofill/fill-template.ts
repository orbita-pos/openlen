// Template + business data → filled HTML with ID-tagged ops. Una sola llamada,
// no streaming; `onChunk` dispara una vez al terminar.
//
// El modelo lo elige la política (`template_autofill`). `OPENLEN_AUTOFILL_PROVIDER=gemini`
// devuelve la llamada nativa de Gemini, que es la que estuvo viva desde el
// 2026-06-02 y sigue siendo el único camino cuando falta la clave de Fireworks.

import { applyOps, parseOps, stripOpIds, tagWithOpIds } from "@/lib/html-ops";
import { createFireworksStreamClient } from "@/lib/ai/fireworks-stream-client";
import { dropDecorativeOps } from "./decorative-ops";
import { getCachedFill, hashFillInput, setCachedFill } from "./cache";
import { sanitizeFilledHtml } from "./sanitize";
import type { ExtractedBusinessData } from "./types";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL_ID =
  process.env.STYLE_MATCH_FILL_MODEL || process.env.STYLE_MATCH_TEXT_MODEL || "gemini-2.5-flash";
const MAX_TOKENS = 16_000;
const TEMPERATURE = 0.5;
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

DELETIONS ARE FORBIDDEN IN AUTOFILL MODE.
Do NOT emit op="delete" for ANY element under ANY circumstance. The template's structure is sacred — it's what the user picked and it's already beautiful. Your job is to replace LEAF TEXT only, never remove structure.

If a template section semantically doesn't match the user's business (e.g., "API documentation" section on a restaurant template), LEAVE IT ALONE — emit no ops for it. The user can either:
  (a) accept the section as-is (it's still beautiful structure)
  (b) edit it via free-form chat later
  (c) pick a different template that fits their business
But you, the autofill model, do NOT delete sections. Ever.

═══════════════════════════════════════════
PROTOCOL — ID-tagged ops
═══════════════════════════════════════════

<edit op="replace" target="<id-of-LEAF-element>"><new-element-html /></edit>

(op="delete" is NOT allowed in autofill mode. See deletion rules below.)

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
- features[] → feature card titles + descriptions, 1:1 mapping; if user has 4 features but template has 6 cards, only fill the first 4 and leave the rest untouched
- pricing[] → pricing tier names + prices + bullet lists; if user has 2 tiers but template has 3, fill the first 2 and leave the 3rd as the template's original copy (do NOT delete it)
- testimonials[] → testimonial quotes + author lines; 1:1 mapping with cap at template count; leftover slots stay as original
- faq_questions[] → FAQ Q + A pairs; same 1:1 with cap; leftovers stay as original

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
  opts: { clonedTemplate?: boolean; roleAware?: boolean } = {},
): string {
  return `Fill this landing page template with the business data below.
${opts.clonedTemplate ? CLONED_TEMPLATE_ADDENDUM : ""}
${opts.roleAware ? ROLE_MARKER_ADDENDUM : ""}

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

// Autofill's sparse-data rule ("no data for this slot → leave the template's
// copy") is right when the user is matching their OWN site: inventing facts
// would be worse than a generic line. It is wrong when the document is a clone
// of someone else's page, because "leave it" then means shipping the previous
// business's identity — measured in the wild as "¿Por qué MORADA?" on a
// different agency's page and "© VITRINA · Punto de venta" in a game store's
// footer. This addendum splits the two: facts still may not be invented, but
// the previous brand may not survive.
const CLONED_TEMPLATE_ADDENDUM = `
═══════════════════════════════════════════
CLONED-TEMPLATE MODE — read before the rules below
═══════════════════════════════════════════

This document is a CLONE of a template that belongs to a DIFFERENT business.
Every visible string still describing that other business is WRONG on this page.

This OVERRIDES the sparse-data rule for IDENTITY (not for facts):

- The previous business's NAME must not survive anywhere — headings, nav,
  footer copyright, section eyebrows, image alts, button labels.
- Claims that only make sense for the previous business must go (its pricing
  model, its industry jargon, its process steps, its "why us" copy).
- A slot with NO matching field in the business data must still be rewritten —
  generically, for THIS business's industry, in THIS business's language.
  Leaving the previous brand's sentence there is never acceptable.

Still forbidden, exactly as before: inventing FACTS you were not given —
prices, addresses, phone numbers, emails, testimonials, customer counts,
years in business, certifications. When you have no fact for a slot, write a
short truthful line about the industry instead, or reuse copy from the pitch.
Structure stays sacred: no deletes, leaf text only, same length budget.
`;

const ROLE_MARKER_ADDENDUM = `
COMPOSED-SECTION ROLE OWNERSHIP

Elements inside data-openlen-role must describe that exact role.
Do not rename minigames as features, stories as testimonials, activities as
services, or any other role as the source component's original business purpose.
The role marker is trusted page structure. Preserve it and change leaf copy only.
`;

export interface FillTemplateInput {
  /** The HTML to fill. Will be tagged with data-op-id internally; do NOT pre-tag. */
  sourceHtml: string;
  /** The document is a clone of ANOTHER business's page (curate / assemble),
   *  so the previous brand's identity must not survive. See the addendum. */
  clonedTemplate?: boolean;
  /** The document carries trusted data-openlen-role composition markers. */
  roleAware?: boolean;
  /** Business data (extracted from image or provided directly). */
  data: ExtractedBusinessData | Record<string, unknown>;
  /** Optional progress callback (fires once on completion — non-streaming). */
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

interface FillModelCall {
  accumulated: string;
  usage?: { inputTokens: number; outputTokens: number };
  finishReason: string | null;
}
type FillModelOutcome =
  | { ok: true; call: FillModelCall }
  | { ok: false; kind: "api" | "aborted"; message: string };

async function callGeminiFill(
  apiKey: string,
  userMessage: string,
  signal: AbortSignal | undefined,
): Promise<FillModelOutcome> {
  const url = `${GEMINI_BASE}/${MODEL_ID}:generateContent?key=${encodeURIComponent(apiKey)}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: FILL_SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: userMessage }] }],
        generationConfig: {
          temperature: TEMPERATURE,
          maxOutputTokens: MAX_TOKENS,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
      ...(signal ? { signal } : {}),
    });
  } catch (err) {
    if (signal?.aborted) return { ok: false, kind: "aborted", message: "Request aborted" };
    return { ok: false, kind: "api", message: err instanceof Error ? err.message : String(err) };
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return { ok: false, kind: "api", message: `Gemini ${response.status}: ${text.slice(0, 400)}` };
  }
  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  return {
    ok: true,
    call: {
      accumulated: payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "",
      ...(payload.usageMetadata
        ? {
            usage: {
              inputTokens: payload.usageMetadata.promptTokenCount ?? 0,
              outputTokens: payload.usageMetadata.candidatesTokenCount ?? 0,
            },
          }
        : {}),
      finishReason: payload.candidates?.[0]?.finishReason ?? null,
    },
  };
}

/** El mismo turno por el transporte compartido. Se drena porque esta llamada
 *  nunca fue en vivo: `onChunk` siempre disparó una sola vez al final. */
async function callDeepSeekFill(
  userMessage: string,
  signal: AbortSignal | undefined,
): Promise<FillModelOutcome> {
  const call: FillModelCall = { accumulated: "", finishReason: null };
  try {
    for await (const event of createFireworksStreamClient().stream(
      {
        messages: [
          { role: "system", content: FILL_SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        maxOutputTokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        requestId: "template-autofill",
        operation: "template_autofill",
      },
      signal ? { signal } : {},
    )) {
      if (event.type === "text_delta") call.accumulated += event.text;
      else if (event.type === "usage") call.usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens };
      else if (event.type === "done") {
        if (event.stopReason.kind === "cancelled") return { ok: false, kind: "aborted", message: "Request aborted" };
        if (event.stopReason.kind === "error") return { ok: false, kind: "api", message: event.stopReason.error };
        // El llamador busca /length|max_?tokens/ para decir "se topó con el
        // techo": traducir el nombre conserva ese diagnóstico.
        call.finishReason = event.stopReason.kind === "max_tokens" ? "MAX_TOKENS" : "STOP";
        break;
      }
    }
  } catch (err) {
    if (signal?.aborted) return { ok: false, kind: "aborted", message: "Request aborted" };
    return { ok: false, kind: "api", message: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true, call };
}

export async function fillTemplate(
  input: FillTemplateInput,
): Promise<FillTemplateResult> {
  const t0 = Date.now();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error: {
        kind: "missing-key",
        message: "GEMINI_API_KEY not set",
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

  // Cache check before tagging — same (sourceHtml + data) = same filledHtml.
  // Saves ~$0.002 and ~6s on repeat fills (demo flows, retries, multi-tab).
  const fillHash = hashFillInput(input.sourceHtml, input.data);
  const cachedFill = getCachedFill(fillHash);
  if (cachedFill) {
    return {
      ok: true,
      filledHtml: cachedFill,
      appliedOps: 0,
      totalOps: 0,
      cascadeErrors: 0,
      finishReason: "cached",
      durationMs: Date.now() - t0,
      rawResponse: "(cached)",
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
  const userMessage = buildFillUserMessage(input.data, taggedHtml, {
    clonedTemplate: input.clonedTemplate,
    roleAware: input.roleAware,
  });
  // Aquí la medición NO favoreció el cambio, al revés que en el Chat y el
  // Agente: misma página y mismos datos, Gemini aplicó 13 ops en 4.36s y
  // DeepSeek 8 en 3.52s, ambos sin errores de cascada. Un segundo menos a
  // cambio de cinco huecos que se quedan con el relleno genérico no es un
  // trato bueno para el usuario. Se deja la costura puesta y el default donde
  // la evidencia lo sostiene: `OPENLEN_AUTOFILL_PROVIDER=deepseek` para
  // encenderlo cuando haya con qué decidir.
  const useDeepSeek = process.env.OPENLEN_AUTOFILL_PROVIDER?.trim().toLowerCase() === "deepseek"
    && !!process.env.FIREWORKS_API_KEY?.trim();
  const outcome = useDeepSeek
    ? await callDeepSeekFill(userMessage, input.signal)
    : await callGeminiFill(apiKey, userMessage, input.signal);
  if (!outcome.ok) {
    return {
      ok: false,
      error: { kind: outcome.kind, message: outcome.message },
      durationMs: Date.now() - t0,
    };
  }
  const { accumulated, usage, finishReason } = outcome.call;
  input.onChunk?.(accumulated.length);

  input.onStage?.("applying");
  const { ops: rawOps, errors: parseErrors } = parseOps(accumulated);
  // Belt-and-suspenders: drop any delete ops the model might emit despite the
  // prompt explicitly forbidding them. Autofill preserves structure;
  // deletions break the template's layout and orphan future chat edits.
  const ops = rawOps.filter((op) => op.type !== "delete");
  if (parseErrors.length > 0 && ops.length === 0) {
    return {
      ok: false,
      error: {
        kind: "parse",
        message: `Couldn't parse ops: ${parseErrors[0]}${/length|max_?tokens/i.test(finishReason ?? "") ? " (response hit token cap)" : ""}`,
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

  // `aria-hidden="true"` is the author saying "this is not content". The model
  // wrote the business name into a one-glyph circle and the CTA label into a
  // card's arrow, so the page showed text it declared did not exist — clipped
  // to "Col egi" and stranded at the right edge. The filler is a model, so a
  // rule in its prompt is a request; dropping the op is the same rule as an
  // invariant.
  const applyResult = applyOps(taggedHtml, dropDecorativeOps(ops, taggedHtml));
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

  const strippedHtml = stripOpIds(applyResult.html);
  const sanitized = sanitizeFilledHtml(strippedHtml);
  if (
    sanitized.removed.scripts > 0 ||
    sanitized.removed.eventHandlers > 0 ||
    sanitized.removed.dangerousUrls > 0 ||
    sanitized.removed.iframes > 0
  ) {
    // Log so prompt-injection attempts surface in telemetry without
    // failing the request — the model cleaned up as it should.
    console.warn("[autofill] sanitizer stripped:", sanitized.removed);
  }
  setCachedFill(fillHash, sanitized.html);
  return {
    ok: true,
    filledHtml: sanitized.html,
    appliedOps: applyResult.appliedCount,
    totalOps: ops.length,
    cascadeErrors: applyResult.errors.length,
    finishReason,
    usage,
    durationMs: Date.now() - t0,
    rawResponse: accumulated,
  };
}
