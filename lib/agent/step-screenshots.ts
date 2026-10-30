// What Len saw, in the chat: the screenshots a step's card may carry. Client-safe (no node
// imports): the chat reads them from the stream, and the chat route cleans what the browser saves.

/** More than one turn's `view_page` allows (6): a card never needs more. */
export const MAX_STEP_SCREENSHOTS = 8;

/** The URL `storeStepScreenshots` gives: the storage's public base + `uploads/<project>/screenshot-<hash>.<ext>`. */
const STEP_SCREENSHOT_URL =
  /^(?:https?:\/\/[^\s"'<>\\]+|\/[^\s"'<>\\]*)?\/uploads\/[A-Za-z0-9_-]{1,64}\/screenshot-[0-9a-f]{32}\.(?:jpg|png|webp)$/;

/** The screenshots a saved card may carry; anything else is dropped. Null if none survive. */
export function screenshotsFrom(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out = v
    .filter((u): u is string => typeof u === "string" && u.length <= 500 && STEP_SCREENSHOT_URL.test(u))
    .slice(0, MAX_STEP_SCREENSHOTS);
  return out.length ? out : null;
}
