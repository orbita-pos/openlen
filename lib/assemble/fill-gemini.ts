// Content fill for the assembler — SAME ID-tagged leaf-ops protocol as autofill's
// fillTemplate, but the model is Gemini Flash (the F3 Gemini-only stack), not
// Kimi/Together. Faster, on-stack, one non-streaming generateContent call.
// Reuses the html-ops engine, the FILL prompt, and the sanitizer verbatim.

import { applyOps, parseOps, stripOpIds, tagWithOpIds } from "@/lib/html-ops";
import { sanitizeFilledHtml } from "@/lib/style-match/autofill/sanitize";
import {
  FILL_SYSTEM_PROMPT,
  buildFillUserMessage,
  type FillTemplateInput,
  type FillTemplateResult,
} from "@/lib/style-match/autofill/fill-template";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL_ID = process.env.ASSEMBLE_FILL_MODEL || process.env.STYLE_MATCH_TEXT_MODEL || "gemini-2.5-flash";
const MAX_TOKENS = 16_000;
const SUCCESS_THRESHOLD = 0.8;

/** Drop-in replacement for fillTemplate, on Gemini Flash. */
export async function fillWithGemini(input: FillTemplateInput): Promise<FillTemplateResult> {
  const t0 = Date.now();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { ok: false, error: { kind: "missing-key", message: "GEMINI_API_KEY not set" }, durationMs: Date.now() - t0 };
  }
  if (!/<html[\s>]/i.test(input.sourceHtml) || !/<\/html>/i.test(input.sourceHtml)) {
    return { ok: false, error: { kind: "empty-html", message: "sourceHtml must be a full HTML document" }, durationMs: Date.now() - t0 };
  }

  input.onStage?.("tagging");
  const { taggedHtml, taggedCount } = tagWithOpIds(input.sourceHtml);
  if (taggedCount === 0) {
    return { ok: false, error: { kind: "empty-html", message: "No taggable elements in HTML" }, durationMs: Date.now() - t0 };
  }

  input.onStage?.("calling-model");
  const url = `${GEMINI_BASE}/${MODEL_ID}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const reqBody = {
    systemInstruction: { parts: [{ text: FILL_SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: buildFillUserMessage(input.data, taggedHtml) }] }],
    generationConfig: { temperature: 0.5, maxOutputTokens: MAX_TOKENS, thinkingConfig: { thinkingBudget: 0 } },
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(reqBody),
      signal: input.signal,
    });
  } catch (err) {
    if (input.signal?.aborted) return { ok: false, error: { kind: "aborted", message: "aborted" }, durationMs: Date.now() - t0 };
    return { ok: false, error: { kind: "api", message: err instanceof Error ? err.message : String(err) }, durationMs: Date.now() - t0 };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: { kind: "api", message: `Gemini ${res.status}: ${text.slice(0, 300)}` }, durationMs: Date.now() - t0 };
  }

  const payload = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const accumulated = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  input.onChunk?.(accumulated.length);
  const usage = payload.usageMetadata
    ? { inputTokens: payload.usageMetadata.promptTokenCount ?? 0, outputTokens: payload.usageMetadata.candidatesTokenCount ?? 0 }
    : undefined;

  input.onStage?.("applying");
  const { ops: rawOps, errors: parseErrors } = parseOps(accumulated);
  const ops = rawOps.filter((op) => op.type !== "delete"); // autofill never deletes structure
  if (ops.length === 0) {
    return {
      ok: false,
      error: { kind: parseErrors.length ? "parse" : "empty-ops", message: parseErrors[0] ?? "Model returned no operations." },
      rawResponse: accumulated,
      durationMs: Date.now() - t0,
    };
  }

  const applied = applyOps(taggedHtml, ops);
  if (!applied.html) {
    return {
      ok: false,
      error: { kind: "apply", message: applied.errors[0]?.reason ?? "Apply produced no HTML" },
      rawResponse: accumulated,
      appliedOps: applied.appliedCount,
      totalOps: ops.length,
      durationMs: Date.now() - t0,
    };
  }
  const successRate = applied.appliedCount / ops.length;
  if (successRate < SUCCESS_THRESHOLD) {
    return {
      ok: false,
      error: { kind: "low-success-rate", message: `Only ${(successRate * 100).toFixed(0)}% of ${ops.length} ops applied` },
      rawResponse: accumulated,
      partialHtml: stripOpIds(applied.html),
      appliedOps: applied.appliedCount,
      totalOps: ops.length,
      durationMs: Date.now() - t0,
    };
  }

  const sanitized = sanitizeFilledHtml(stripOpIds(applied.html));
  return {
    ok: true,
    filledHtml: sanitized.html,
    appliedOps: applied.appliedCount,
    totalOps: ops.length,
    cascadeErrors: applied.errors.length,
    finishReason: null,
    usage,
    durationMs: Date.now() - t0,
    rawResponse: accumulated,
  };
}
