// EL RESUMEN DE LA COMPACTACIÓN, copiado TAL CUAL del arnés de DeepSeek
// (`packages/compaction/compaction-basic/src/summarizer.ts` @ 5badb15, MIT,
// © 2026 DeepSeek — LICENSES/deepseek-harness.MIT.txt). Regla de Jesús
// (04/10): «todo como DeepSeek y Claude Code»; en lo que toca al modelo, el
// arnés de DeepSeek. No se le añade texto propio.
import type { Message } from "@/lib/ai-gateway";
import type { Span } from "./select";

export const SUMMARY_OPEN_TAG = "<compacted-summary>";
export const SUMMARY_CLOSE_TAG = "</compacted-summary>";

export const COMPACTION_INSTRUCTION = [
  "You are now acting as a compaction engine for this AI coding assistant. Condense the conversation ABOVE into a structured checkpoint that lets another model resume the work with no loss of essential context.",
  "",
  'Output EXACTLY the Markdown structure below: keep every section, in order. Use terse bullets, not prose paragraphs. Write "(none)" for an empty section — never drop a section.',
  "",
  "## Primary Request and Intent",
  "- [the user's original and evolving goals; quote verbatim where the exact wording matters]",
  "",
  "## Key Technical Concepts",
  "- [technologies, frameworks, patterns, and conventions in play]",
  "",
  "## Files and Code",
  "- [exact path: why it matters, key changes or snippets]",
  "",
  "## Errors and Fixes",
  "- [error: how it was resolved, plus any related user feedback]",
  "",
  "## Pending Jobs",
  "- [explicitly requested work not yet completed]",
  "",
  "## Current Work",
  "- [precisely what was in progress at this checkpoint]",
  "",
  "## Next Step",
  '- [the single next action, directly in line with the most recent request, or "(none)"]',
  "",
  "## Critical Context",
  "- [decisions and their rationale, constraints, user preferences, open questions, data needed to continue]",
  "",
  "Rules:",
  "- Write concise English engineering prose. Preserve exact file paths, commands, error strings, identifiers, numeric values, function signatures, and syntax fragments.",
  "- Capture user feedback and explicit instructions faithfully, especially corrections.",
  "- Do NOT mention this summarization request or that the context was compacted.",
  "- Output only the checkpoint text: do not call any tool or take any other action.",
  `- If the conversation already contains a ${SUMMARY_OPEN_TAG} block, it is a PRIOR checkpoint. Do not copy it forward verbatim: preserve still-true facts, drop stale ones, and merge newer information into a single consolidated summary under the same structure.`,
].join("\n");

export const CHECKPOINT_PREAMBLE =
  "This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it. Continue the task directly from the messages that follow, without acknowledging this checkpoint.";

/** La misma petición que la última vuelta hasta el final del tramo, y la
 *  instrucción AL FINAL: el prefijo sale de la caché (DeepSeek, «reuses the
 *  provider's warm prefix»). */
export function buildSummaryRequest(messages: readonly Message[], span: Span): Message[] {
  return [...messages.slice(0, span.end), { role: "user", content: COMPACTION_INSTRUCTION }];
}

/** El tramo, sustituido por UN mensaje del usuario con el marco de DeepSeek
 *  (`frameSummary`): preámbulo, etiqueta, resumen, etiqueta. */
export function applySummary(messages: readonly Message[], span: Span, summary: string): Message[] {
  const replacement: Message = {
    role: "user",
    content: `${CHECKPOINT_PREAMBLE}\n\n${SUMMARY_OPEN_TAG}\n${summary.trim()}\n${SUMMARY_CLOSE_TAG}`,
  };
  return [...messages.slice(0, span.start), replacement, ...messages.slice(span.end)];
}
