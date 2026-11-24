export const GENERATION_BRIEF_MIN_LENGTH = 10;
/** The cap of the retired /api/generate's brief, kept only by the unmounted brief panel's hook
 *  (`components/generation-brief-limit.tsx`). What the home sends to Len has NO maximum (24/11, Jesús: «claude code no
 *  tiene eso»): Claude Code 2.1.330 sends whatever is written — past 10,000 characters its box only SHOWS the middle as
 *  «[...Truncated text #N +X lines...]». The model's context is the only limit, as for every message in Len's chat. */
export const GENERATION_BRIEF_MAX_LENGTH = 4000;

const GENERATION_BRIEF_COUNTER_THRESHOLD = GENERATION_BRIEF_MAX_LENGTH * 0.75;

/** Prefix capped in UTF-16 units (the same units used by `maxLength`) without
 *  leaving a high surrogate detached from its low surrogate. */
export function utf16SafePrefix(value: string, maxLength: number): string {
  let end = Math.min(value.length, Math.max(0, Math.floor(maxLength)));
  if (end > 0 && end < value.length) {
    const previous = value.charCodeAt(end - 1);
    const next = value.charCodeAt(end);
    const splitsSurrogatePair =
      previous >= 0xd800 &&
      previous <= 0xdbff &&
      next >= 0xdc00 &&
      next <= 0xdfff;
    if (splitsSurrogatePair) end -= 1;
  }
  return value.slice(0, end);
}

export function trimGenerationBrief(value: string): string {
  return value.trim();
}

/** Long enough to send. No maximum: see `GENERATION_BRIEF_MAX_LENGTH`. */
export function isGenerationBriefLengthValid(value: string): boolean {
  return trimGenerationBrief(value).length >= GENERATION_BRIEF_MIN_LENGTH;
}

export function shouldShowGenerationBriefCounter(length: number): boolean {
  return length > GENERATION_BRIEF_COUNTER_THRESHOLD;
}

export interface GenerationBriefPasteInput {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  pastedText: string;
}

export interface GenerationBriefPasteResult {
  value: string;
  caret: number;
  truncated: boolean;
}

/** Applies a paste exactly as a textarea with the generation cap should.
 *  Doing it ourselves makes the discarded suffix observable instead of
 *  relying on the browser's otherwise silent `maxLength` truncation. */
export function applyGenerationBriefPaste({
  value,
  selectionStart,
  selectionEnd,
  pastedText,
}: GenerationBriefPasteInput): GenerationBriefPasteResult {
  const start = Math.max(0, Math.min(value.length, selectionStart, selectionEnd));
  const end = Math.max(start, Math.min(value.length, Math.max(selectionStart, selectionEnd)));
  const retainedLength = value.length - (end - start);
  const capacity = Math.max(0, GENERATION_BRIEF_MAX_LENGTH - retainedLength);
  const acceptedText = utf16SafePrefix(pastedText, capacity);

  return {
    value: `${value.slice(0, start)}${acceptedText}${value.slice(end)}`,
    caret: start + acceptedText.length,
    truncated: acceptedText.length < pastedText.length,
  };
}

export interface PreparedGenerationBriefInput {
  value: string;
  truncated: boolean;
  autostartAllowed: boolean;
}

/** Normalizes untrusted prefill text (a link's `?brief=`): trimmed, never cut — a URL bounds its own length. It still
 *  never sends by itself: only the home's own ticket does (`lib/marketing/first-message-in-transit.ts`). */
export function prepareGenerationBriefInput(
  rawValue: string | null | undefined,
): PreparedGenerationBriefInput {
  const value = trimGenerationBrief(rawValue ?? "");
  return {
    value,
    truncated: false,
    autostartAllowed: isGenerationBriefLengthValid(value),
  };
}

/** Distinguishes an explicit client-side deep-link from query cleanup inside
 *  the workspace. `undefined` means there is no pending self-normalization. */
export function shouldSyncGenerationBriefParam(
  previousParam: string | null,
  nextParam: string | null,
  ownNormalizedParam: string | null | undefined,
): boolean {
  if (previousParam === nextParam) return false;
  if (
    ownNormalizedParam !== undefined &&
    ownNormalizedParam === nextParam
  ) {
    return false;
  }
  return nextParam !== null;
}
