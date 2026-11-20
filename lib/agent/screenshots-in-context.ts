// Screenshots the agent took (view_page, use_page) travel as images in the
// message that follows a batch of tool results, like Claude Code's own
// screenshots: the agent looks at them itself. They STAY in the conversation,
// where they were sent, as in Claude Code (a request holds up to 100 media
// items; past that the oldest 21 become text at once) and in DeepSeek's harness
// (kept until the provider refuses the request, then the oldest go 20 at a
// time and never come back).
//
// ⚰️ Until 14/11 only three kept their pixels («Fireworks does not cache
// them»), and every few screenshots an earlier message was rewritten. The wire
// probe showed that on DeepInfra, Len's provider, a request's images are part
// of what is cached; and in production (the 30 days before) those rewrites were
// 42 of the 52 cache breaks recorded — a turn that looks does it 8 times at the
// median and 31 at most.

// Cache effect: none while the conversation holds up to SCREENSHOTS_KEPT screenshots — nothing sent is rewritten. Past that the oldest lose their pixels in whole batches of SCREENSHOTS_QUANTUM, one rewrite per batch; which ones go depends only on how many there have been, so every later turn drops the same ones.
import type { InlineImage, Message } from "@/lib/ai-gateway";

/** Screenshots that keep their pixels in the conversation before any goes. */
export const SCREENSHOTS_KEPT = 40;
/** How many go at once when that is passed: DeepSeek's quantum. */
export const SCREENSHOTS_QUANTUM = 20;

/** The environment these read: the process's, or a plain object in a test. */
type Env = Readonly<Record<string, string | undefined>>;

/** The limit in force. `OPENLEN_SCREENSHOTS_KEPT` (a whole number above zero) moves it, and half of it goes at
 *  once when it is passed; an unrecognized value is ignored. How a provider takes a request with forty real
 *  screenshots in it was not measured before this shipped: this is the way back without a deploy. */
export function screenshotLimits(env: Env = process.env): { kept: number; quantum: number } {
  const raw = env.OPENLEN_SCREENSHOTS_KEPT?.trim() ?? "";
  if (!/^[1-9]\d*$/.test(raw)) return { kept: SCREENSHOTS_KEPT, quantum: SCREENSHOTS_QUANTUM };
  const kept = Number(raw);
  return { kept, quantum: Math.max(1, Math.ceil(kept / 2)) };
}

const DROPPED_NOTE = "(The screenshots that were here were dropped to keep the turn light: take a new one if you need to look again.)";
const SUMMARY_MAX_CHARS = 220;
const JS_ERRORS_LINE = "JavaScript errors in the visit:";
/** The `·` detail lines of a step that say it did nothing: the lead clause is the fact, the rest explains it
 *  (`usar-pagina.ts`: «nothing changed: not what is shown…», «nothing else changed…», and a reload's «after
 *  reloading, the page looks the same as before reloading»). */
const NOTHING_CHANGED = /^·\s+(nothing (?:else )?changed|after reloading, the page looks the same as before reloading)/;

/** The first `n` characters, without the half of a surrogate pair (an emoji) the cut may land in. */
function firstChars(text: string, n: number): string {
  const cut = text.slice(0, n);
  return /[\ud800-\udbff]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/** Fits the gist in the cap. The `JavaScript errors` line is the fact the gist exists for, so it is never the part
 *  that goes: the steps in the middle give way to it. An errors line that alone passes the cap is kept from its start. */
function fitGist(middle: readonly string[], errors: string): string {
  const mid = middle.join(" | ").replace(/\s+/g, " ").trim();
  const last = errors.replace(/\s+/g, " ").trim();
  const whole = [mid, last].filter((x) => x !== "").join(" | ");
  if (whole.length <= SUMMARY_MAX_CHARS) return whole;
  if (last === "") return `${firstChars(mid, SUMMARY_MAX_CHARS)}…`;
  // «<middle>… | <errors line>» inside the cap.
  const room = SUMMARY_MAX_CHARS - last.length - " | ".length - "…".length;
  if (room <= 0) return last.length <= SUMMARY_MAX_CHARS ? last : `${firstChars(last, SUMMARY_MAX_CHARS)}…`;
  return `${firstChars(mid, room).trimEnd()}… | ${last}`;
}

/** Extracts a short deterministic factual gist from dropped browser tool responses so facts survive pixel eviction:
 *  each step, the ones that did nothing, and the JavaScript errors of the visit. */
function droppedObservationSummary(responses: Carrier["functionResponses"]): string | null {
  if (!responses?.length) return null;
  for (const r of responses) {
    if (r.name !== "use_page" && r.name !== "view_page") continue;
    const visit = typeof r.response?.visit === "string" ? r.response.visit : typeof r.response?.summary === "string" ? r.response.summary : "";
    if (!visit) continue;
    const middle: string[] = [];
    let errors = "";
    for (const raw of visit.split("\n")) {
      const line = raw.trim();
      if (/^\d+\.\s/.test(line)) middle.push(line);
      else if (line.startsWith(JS_ERRORS_LINE)) errors = line;
      else {
        const nothing = NOTHING_CHANGED.exec(line);
        if (nothing) middle.push(nothing[1]!);
      }
    }
    const gist = fitGist(middle, errors);
    if (!gist) continue;
    return `Observed before screenshots were dropped: ${gist}`;
  }
  return null;
}

export interface BatchScreenshots {
  readonly tool: string;
  readonly images: readonly InlineImage[];
  /** Where each one was stored, in order, when storing worked (`Message.screenshots`). */
  readonly urls?: readonly string[];
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

/** How many of the conversation's screenshots, counted from the oldest, have lost their pixels once there
 *  have been `total`: none up to the limit, then whole batches of the quantum (DeepSeek's
 *  `offloadedImagePrefixCount`). It depends on the count alone and only ever grows. */
export function droppedScreenshotCount(total: number, kept = SCREENSHOTS_KEPT, quantum = SCREENSHOTS_QUANTUM): number {
  return total <= kept ? 0 : Math.ceil((total - kept) / quantum) * quantum;
}

type Carrier = Pick<Message, "content" | "functionResponses" | "images" | "screenshots" | "screenshotsDropped">;

/** The screenshots a tool-result message carries or carried: its pixels, their stored addresses when the pixels
 *  are not loaded, or how many it had when they were dropped. The person's own photos are not these. */
function screenshotsOf(m: Carrier): number {
  if (!m.functionResponses?.length) return 0;
  return m.screenshotsDropped ?? m.screenshots?.length ?? m.images?.length ?? 0;
}

/** A tool-result message without its screenshots: its text, the note that says they were dropped (once) and
 *  how many they were. They never come back. */
export function dropScreenshots<M extends Carrier>(m: M): M {
  if (m.screenshotsDropped !== undefined) return m;
  const { images: _pixels, screenshots: _addresses, ...rest } = m;
  const summary = droppedObservationSummary(m.functionResponses);
  return {
    ...rest,
    content: [m.content, summary ?? "", DROPPED_NOTE].filter((x) => x.length > 0).join("\n\n"),
    screenshotsDropped: screenshotsOf(m),
  } as M;
}

/**
 * The conversation with the screenshots it may keep. Pure. The oldest `droppedScreenshotCount` lose their
 * pixels — a message goes whole, and says so once —; one already dropped stays dropped and keeps counting; the
 * newest batch always stays. The same function serves the turn's own messages and the history a later turn
 * rebuilds: which ones go follows from how many there have been.
 */
export function applyScreenshotBudget<M extends Carrier>(messages: readonly M[], kept = screenshotLimits().kept, quantum = screenshotLimits().quantum): M[] {
  const total = messages.reduce((n, m) => n + screenshotsOf(m), 0);
  const toDrop = droppedScreenshotCount(total, kept, quantum);
  if (toDrop === 0) return [...messages];
  const newest = messages.findLastIndex((m) => screenshotsOf(m) > 0);
  let before = 0;
  return messages.map((m, i) => {
    const mine = screenshotsOf(m);
    if (mine === 0) return m;
    const goes = before < toDrop && i !== newest && m.screenshotsDropped === undefined;
    before += mine;
    return goes ? dropScreenshots(m) : m;
  });
}

/** `applyScreenshotBudget` on the loop's own messages, in place. */
export function keepRecentScreenshots(messages: Message[], kept = screenshotLimits().kept, quantum = screenshotLimits().quantum): void {
  const next = applyScreenshotBudget(messages, kept, quantum);
  for (let i = 0; i < messages.length; i++) if (next[i] !== messages[i]) messages[i] = next[i]!;
}
