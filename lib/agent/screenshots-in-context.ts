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

/** Drops the pixels of older tool-result screenshots, in place. The user's own
 *  photos (a user message without tool results) are never touched. */
export function keepRecentScreenshots(messages: Message[], keep = MAX_SCREENSHOTS_IN_CONTEXT): void {
  let kept = 0;
  let newest = true;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (!m.functionResponses?.length || !m.images?.length) continue;
    if (newest || kept + m.images.length <= keep) {
      kept += m.images.length;
      newest = false;
      continue;
    }
    const { images: _dropped, ...rest } = m;
    messages[i] = { ...rest, content: [m.content, DROPPED_NOTE].filter((x) => x.length > 0).join("\n\n") };
  }
}
