// Screenshots the agent took (view_page, use_page) travel as images in the
// message that follows a batch of tool results, like Claude Code's own
// screenshots: the agent looks at them itself. Each one is ~1,000 tokens that
// Fireworks does not cache and that every later step of the turn re-sends, so
// only the most recent ones keep their pixels; older ones keep their label and
// say they were dropped (how DeepSeek's harness handles old photos).
import type { InlineImage, Message } from "@/lib/ai-gateway";

/** Screenshots that keep their pixels in the conversation, the newest batch always whole. */
export const MAX_SCREENSHOTS_IN_CONTEXT = 3;

const DROPPED_NOTE = "(The screenshots that were here were dropped to keep the turn light: take a new one if you need to look again.)";

export interface BatchScreenshots {
  readonly tool: string;
  readonly images: readonly InlineImage[];
}

/** The line that tells the agent which image came from which call, in order. */
export function screenshotsLabel(batch: readonly BatchScreenshots[]): string {
  let n = 0;
  const parts = batch.map((b) => {
    const from = n + 1;
    n += b.images.length;
    return b.images.length === 1 ? `image ${from} from ${b.tool}` : `images ${from}–${n} from ${b.tool}`;
  });
  return `Screenshots below, in order: ${parts.join("; ")}. Look at them yourself.`;
}

/** Drops the pixels of older tool-result screenshots, in place, IN JUMPS (A7 of
 *  Len 3.1, like the history's microcompact): while the screenshots that keep
 *  their pixels fit in `keep`, nothing is touched; past it, every batch but the
 *  newest loses its pixels at once. Dropping one per step rewrote an earlier
 *  message on every step from the 4th screenshot on, and each rewrite pays the
 *  rest of the turn again uncached; in jumps it happens once every few, with
 *  never more than `keep` images. The newest batch always stays whole, and the
 *  user's own photos (a user message without tool results) are never touched. */
export function keepRecentScreenshots(messages: Message[], keep = MAX_SCREENSHOTS_IN_CONTEXT): void {
  const withPixels = messages.flatMap((m, i) => (m.functionResponses?.length && m.images?.length ? [i] : []));
  const total = withPixels.reduce((n, i) => n + messages[i]!.images!.length, 0);
  if (total <= keep) return;
  for (const i of withPixels.slice(0, -1)) {
    const m = messages[i]!;
    const { images: _dropped, ...rest } = m;
    messages[i] = { ...rest, content: [m.content, DROPPED_NOTE].filter((x) => x.length > 0).join("\n\n") };
  }
}
