export const GENERATION_BRIEF_MIN_LENGTH = 10;
export const GENERATION_BRIEF_MAX_LENGTH = 4000;

const GENERATION_BRIEF_COUNTER_THRESHOLD = GENERATION_BRIEF_MAX_LENGTH * 0.75;

/** Prefix capped in UTF-16 units (the same units used by `maxLength`) without
 *  leaving a high surrogate detached from its low surrogate. */
function utf16SafePrefix(value: string, maxLength: number): string {
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

export function isGenerationBriefLengthValid(value: string): boolean {
  const length = trimGenerationBrief(value).length;
  return (
    length >= GENERATION_BRIEF_MIN_LENGTH &&
    length <= GENERATION_BRIEF_MAX_LENGTH
  );
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

/** Normalizes untrusted prefill text. An oversized deep-link is visible in a
 *  bounded textarea, but never starts a billable generation automatically. */
export function prepareGenerationBriefInput(
  rawValue: string | null | undefined,
): PreparedGenerationBriefInput {
  const trimmed = trimGenerationBrief(rawValue ?? "");
  const truncated = trimmed.length > GENERATION_BRIEF_MAX_LENGTH;
  const value = truncated
    ? utf16SafePrefix(trimmed, GENERATION_BRIEF_MAX_LENGTH)
    : trimmed;

  return {
    value,
    truncated,
    autostartAllowed: !truncated && isGenerationBriefLengthValid(value),
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
