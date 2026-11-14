// THE IDLE SUMMARY (spec local 2026-11-13-conversar-todo-el-mes, piece B). A long conversation that sits idle
// is summarized while the provider still has it cached — the request is the conversation exactly as it was
// sent plus the summary instruction, so almost all of it is read at the cached price —, and the summary
// waits on the turn's row. If the person comes back after the cache expired, that turn starts from the
// summary instead of paying the whole conversation again at the full input price; if they come back while
// it is still warm, the summary is ignored and the conversation goes on whole.
//
// The trigger is Claude Code's idle compaction (binary 2.1.321: «a 200K+ token conversation left idle is
// summarized, and the summary is used on your next message if the prompt cache has expired»; it fires at 90 %
// of the cache's life, only while warm, never near the usage limit, and a newer request cancels it). Here the
// cache's life is the one measured on Len's provider — alive after 45 minutes of silence, gone after 60 —, so
// the summary is asked for at minute 40 (`IDLE_SUMMARY_AT`). The
// summary itself is the compaction this repo already has, DeepSeek's (./compaction/compact.ts, trigger
// `idle`): same model, same request, the instruction at the end, and a summary that does not shrink the
// conversation is refused.
//
// Effect on the cache: none while the conversation is warm — nothing it sends changes. A cold turn that
// starts from the summary sends a new, short history; the turns after it extend that one.
//
// The timers live in this process: a restart loses them, and the turn that comes back cold then falls back
// to the cold return's trim (./cold-return.ts) and nothing else.
//
// When its timer fires, a summary is asked for only if it still makes sense — Claude Code's checks at that
// same moment: the timer is not more than a minute late (its `lapsed`: the process slept, the cache may be
// gone), and the turn it was armed for is still the conversation's last one (its `prefix_changed` and
// `newer_request`: archived, deleted, or a turn this process did not cancel for). The call then has a
// deadline — Claude Code has none of its own; here nothing else would ever cut a provider that stopped
// answering, and the conversation would hold its place and its messages for good.
//
// What stays as in Claude Code: a person who comes back AFTER the summary was written and BEFORE the
// conversation is cold (between minute 40 and 60, by default) is answered with the conversation whole,
// and that summary was paid for nothing. It is the price of writing it while it is cheap.
import type { Message, StreamEvent } from "@/lib/ai-gateway";
import { coldAfterMs } from "@/lib/agent/cold-return";
import { compactIfNeeded } from "@/lib/agent/compaction/compact";
import { estimateTokens } from "@/lib/agent/compaction/estimate";
import type { CompactionMark } from "@/lib/agent/compaction/mark";

/** The environment these read: the process's, or a plain object in a test. */
type Env = Readonly<Record<string, string | undefined>>;

/** From what size a conversation is summarized: what the measurement of the spec fixed (§8.5, 14/11). From
 *  40.000 tokens the summary saved over 40 % of a cold return and broke no question; at 30.000 it saved 28 %.
 *  Claude Code's own default is 200.000, in a product where resuming is not billed apart. */
export const IDLE_SUMMARY_MIN_TOKENS_DEFAULT = 40_000;
/** The literal tail the summary keeps, as a share of the minimum: DeepSeek's proportion (16 %). */
export const IDLE_SUMMARY_RETAIN_RATIO = 0.16;
/** When it fires, as a share of the time after which a turn is cold: two thirds — minute 40 of 60. Claude
 *  Code's rule is 90 % of the CACHE's life, and the provider's cache was last seen alive at minute 45
 *  (./cold-return.ts): 90 % of the cold threshold fired after it, and a summary written cold reads the whole
 *  conversation at the full input price. */
export const IDLE_SUMMARY_AT = 2 / 3;
/** Conversations waiting at once. Each holds its messages in memory until it fires; past this, a new one
 *  is not armed and its cold return is only trimmed. */
export const IDLE_SUMMARY_MAX_ARMED = 200;

/** What a summary writes, roughly: for asking whether the owner's balance covers one before asking for it. */
export const IDLE_SUMMARY_OUTPUT_ESTIMATE = 3_000;
/** A timer that fires later than this after it was due does nothing: Claude Code's 60 s. */
export const IDLE_SUMMARY_LATE_MS = 60_000;

/** Opt-out: only the literal `0` turns it off (no timer is armed and no pending summary is promoted). */
export function idleSummaryEnabled(env: Env = process.env): boolean {
  return env.OPENLEN_IDLE_SUMMARY !== "0";
}

/** From what size a conversation is worth summarizing. `OPENLEN_IDLE_SUMMARY_MIN_TOKENS` (a whole number
 *  above zero) moves it; an unrecognized value is ignored. */
export function idleSummaryMinTokens(env: Env = process.env): number {
  const raw = env.OPENLEN_IDLE_SUMMARY_MIN_TOKENS?.trim() ?? "";
  return /^[1-9]\d*$/.test(raw) ? Number(raw) : IDLE_SUMMARY_MIN_TOKENS_DEFAULT;
}

/** How long after a turn ends its summary is written: before the cache expires, late enough that the person
 *  has most likely left. */
export function idleSummaryDelayMs(env: Env = process.env): number {
  return Math.round(coldAfterMs(env) * IDLE_SUMMARY_AT);
}

/** How long the summary's call may take once its timer fires: until the conversation would be cold. */
export function idleSummaryDeadlineMs(env: Env = process.env): number {
  return coldAfterMs(env) - idleSummaryDelayMs(env);
}

export interface IdleUsage {
  readonly inputTokens: number;
  /** A subset of `inputTokens`. */
  readonly cachedTokens: number;
  readonly outputTokens: number;
}

/** A summary written while idle, waiting on its turn's row (`TranscripcionGuardada.idleSummary`) until a
 *  cold turn promotes it to the row's compaction mark. */
export interface PendingIdleSummary {
  readonly mark: CompactionMark;
  /** ISO. */
  readonly writtenAt: string;
}

/** What one conversation's summary needs. Built when a turn ends (./idle-summary-job.ts); everything that
 *  touches the model, the balance or the database comes through here. */
export interface IdleSummaryJob {
  /** `${projectId}:${conversation ?? ""}`: one summary waits per conversation. */
  readonly key: string;
  /** What the turn was given plus its own transcript: the request the provider has cached, plus the turn's
   *  closing answer (pinned in loop.test.ts). */
  readonly messages: readonly Message[];
  /** The first message that may be summarized: 2, after the system prompt and the manual, as in the turn. */
  readonly firstIndex: number;
  /** How many messages the turn's own transcript has: the mark covers them all. */
  readonly transcriptLength: number;
  readonly minTokens: number;
  /** Asked when the timer fires: is the turn this was armed for still the conversation's last one? */
  stillCurrent(): Promise<boolean>;
  canAfford(estimatedInputTokens: number): Promise<boolean>;
  /** ONE model call. `text: null` = no usable summary (it called a tool, was cut, failed); `usage: null` =
   *  the provider reported nothing, so there is nothing to charge. */
  summarize(request: Message[], signal: AbortSignal): Promise<{ text: string | null; usage: IdleUsage | null }>;
  charge(usage: IdleUsage): Promise<void>;
  save(pending: PendingIdleSummary): Promise<void>;
}

/**
 * One model call, read to its end: the text of the summary and what the provider reported. The loop's own
 * rule for a summary it asks for (`summarizeWithModel`, ./loop.ts): it is one only if the model called no
 * tool and finished its answer with something in it. A stream that breaks gives no summary; whatever
 * usage arrived before is still returned, because it was spent.
 */
export async function collectSummary(stream: AsyncIterable<StreamEvent>): Promise<{ text: string | null; usage: IdleUsage | null }> {
  let text = "";
  let usage: IdleUsage | null = null;
  let calledTool = false;
  let finished = false;
  try {
    for await (const ev of stream) {
      if (ev.type === "text_delta") text += ev.text;
      else if (ev.type === "function_call") calledTool = true;
      else if (ev.type === "usage") usage = { inputTokens: ev.inputTokens, cachedTokens: Math.min(ev.cachedTokens, ev.inputTokens), outputTokens: ev.outputTokens };
      else if (ev.type === "done") finished = ev.stopReason.kind === "end_turn";
    }
  } catch {
    return { text: null, usage };
  }
  return { text: finished && !calledTool && text.trim() !== "" ? text : null, usage };
}

export type IdleSummaryOutcome = "saved" | "small" | "stale" | "unaffordable" | "no_summary" | "cancelled";

const warn = (key: string, what: string, err: unknown) =>
  console.warn(`[idle-summary] ${key}: ${what} — ${err instanceof Error ? err.message : String(err)}`);

/**
 * Writes one conversation's summary, now. `signal`: a newer turn of the conversation cancels it — whatever
 * is in flight is abandoned and nothing is saved. Nothing is asked for, and so nothing is charged, when the
 * conversation is short, is no longer the one this was armed for (`stale`) or cannot be paid.
 */
export async function runIdleSummary(job: IdleSummaryJob, signal: AbortSignal, now: () => Date = () => new Date()): Promise<IdleSummaryOutcome> {
  if (signal.aborted) return "cancelled";
  const tokens = estimateTokens(job.messages);
  if (tokens < job.minTokens) return "small";
  if (!(await job.stillCurrent())) return "stale";
  if (signal.aborted) return "cancelled";
  if (!(await job.canAfford(tokens))) return "unaffordable";
  if (signal.aborted) return "cancelled";

  let called = false;
  const outcome = await compactIfNeeded({
    messages: job.messages,
    firstIndex: job.firstIndex,
    pressureTokens: tokens,
    policy: { thresholdTokens: job.minTokens, retainTokens: Math.floor(job.minTokens * IDLE_SUMMARY_RETAIN_RATIO) },
    trigger: "idle",
    summarize: async (request) => {
      // One call only: nobody asked for this summary, so it is not tried again.
      if (called || signal.aborted) return null;
      called = true;
      const { text, usage } = await job.summarize(request, signal);
      // The call was made: it is charged whether or not its summary is kept. A charge that fails is said
      // and does not lose the summary.
      if (usage) await job.charge(usage).catch((err) => warn(job.key, "the summary could not be charged", err));
      return text;
    },
  });
  if (signal.aborted) return "cancelled";
  if (!outcome.summarized) return "no_summary";

  const mark: CompactionMark = {
    messages: structuredClone(outcome.messages.slice(job.firstIndex)),
    fromTranscript: job.transcriptLength,
    trigger: "idle",
    preTokens: Math.round(tokens),
    postTokens: Math.round(estimateTokens(outcome.messages)),
    // No `skills`: nothing comes back behind an idle summary (the turn's session is long closed), and a mark
    // that names none makes the history forget everything its row had loaded (`foldLoadedSkills`) — `skill`
    // gives it whole again when asked. An empty list would keep what the row loaded, which is gone.
  };
  await job.save({ mark, writtenAt: now().toISOString() });
  return "saved";
}

interface Waiting {
  timer: ReturnType<typeof setTimeout> | null;
  /** Running: what abandons the call if it is still not answered. */
  deadline: ReturnType<typeof setTimeout> | null;
  readonly controller: AbortController;
}

export interface ArmOptions {
  /** How long the call may take once the timer fires. Absent = nothing cuts it. */
  readonly deadlineMs?: number;
  /** The clock, in ms: a test's. */
  readonly now?: () => number;
}

const waiting = new Map<string, Waiting>();

/** Arms a conversation's summary to be written `delayMs` from now. Arming it again replaces the one that
 *  was waiting. `false`: not armed — too many conversations are waiting already. */
export function armIdleSummary(job: IdleSummaryJob, delayMs: number, opts: ArmOptions = {}): boolean {
  cancelIdleSummary(job.key);
  if (waiting.size >= IDLE_SUMMARY_MAX_ARMED) return false;
  const now = opts.now ?? Date.now;
  const dueAt = now() + delayMs;
  const entry: Waiting = { timer: null, deadline: null, controller: new AbortController() };
  const done = () => {
    if (entry.deadline) clearTimeout(entry.deadline);
    entry.deadline = null;
    if (waiting.get(job.key) === entry) waiting.delete(job.key);
  };
  entry.timer = setTimeout(() => {
    entry.timer = null;
    const late = now() - dueAt;
    if (late > IDLE_SUMMARY_LATE_MS) {
      // The process slept or was too busy to fire on time: by now the provider's cache may be gone, and the
      // call would be paid whole. The cold return's trim is what is left.
      console.warn(`[idle-summary] ${job.key}: fired ${Math.round(late / 1000)} s late — nothing was asked`);
      return done();
    }
    if (opts.deadlineMs !== undefined) {
      entry.deadline = setTimeout(() => {
        entry.deadline = null;
        console.warn(`[idle-summary] ${job.key}: not answered in ${Math.round(opts.deadlineMs! / 1000)} s — abandoned`);
        entry.controller.abort();
      }, opts.deadlineMs);
      entry.deadline.unref?.();
    }
    void runIdleSummary(job, entry.controller.signal)
      .catch((err) => warn(job.key, "the summary could not be written", err))
      .finally(done);
  }, delayMs);
  // A summary nobody is waiting for never keeps the process alive.
  entry.timer.unref?.();
  waiting.set(job.key, entry);
  return true;
}

/** A newer turn of the conversation: its timer is cleared and a summary being written is abandoned. */
export function cancelIdleSummary(key: string): void {
  const entry = waiting.get(key);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  if (entry.deadline) clearTimeout(entry.deadline);
  entry.controller.abort();
  waiting.delete(key);
}

/** How many conversations are waiting for their summary or having it written. */
export function armedIdleSummaries(): number {
  return waiting.size;
}
