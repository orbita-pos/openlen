// THE IDLE SUMMARY (spec local 2026-11-13-conversar-todo-el-mes, piece B). A long conversation that sits idle
// is summarized while the provider still has it cached — the request is the conversation exactly as it was
// sent plus the summary instruction, so almost all of it is read at the cached price —, and the summary
// waits on the turn's row. If the person comes back after the cache expired, that turn starts from the
// summary instead of paying the whole conversation again at the full input price; if they come back while
// it is still warm, the summary is ignored and the conversation goes on whole.
//
// The trigger is Claude Code's idle compaction (binary 2.1.321: «a 200K+ token conversation left idle is
// summarized, and the summary is used on your next message if the prompt cache has expired»; it fires at 90 %
// of the cache's life, only while warm, never near the usage limit, and a newer request cancels it). The
// summary itself is the compaction this repo already has, DeepSeek's (./compaction/compact.ts, trigger
// `idle`): same model, same request, the instruction at the end, and a summary that does not shrink the
// conversation is refused.
//
// Effect on the cache: none while the conversation is warm — nothing it sends changes. A cold turn that
// starts from the summary sends a new, short history; the turns after it extend that one.
//
// The timers live in this process: a restart loses them, and the turn that comes back cold then falls back
// to the cold return's trim (./cold-return.ts) and nothing else.
import type { Message } from "@/lib/ai-gateway";
import { coldAfterMs } from "@/lib/agent/cold-return";
import { compactIfNeeded } from "@/lib/agent/compaction/compact";
import { estimateTokens } from "@/lib/agent/compaction/estimate";
import type { CompactionMark } from "@/lib/agent/compaction/mark";

/** The environment these read: the process's, or a plain object in a test. */
type Env = Readonly<Record<string, string | undefined>>;

/** Where the measurement of the spec (§8) starts from: Claude Code's floor. Its own default is 200.000. */
export const IDLE_SUMMARY_MIN_TOKENS_DEFAULT = 100_000;
/** The literal tail the summary keeps, as a share of the minimum: DeepSeek's proportion (16 %). */
export const IDLE_SUMMARY_RETAIN_RATIO = 0.16;
/** When it fires, as a share of the time after which a turn is cold: Claude Code's 90 %. */
export const IDLE_SUMMARY_AT = 0.9;
/** Conversations waiting at once. Each holds its messages in memory until it fires; past this, a new one
 *  is not armed and its cold return is only trimmed. */
export const IDLE_SUMMARY_MAX_ARMED = 200;

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

/** What one conversation's summary needs. The route builds it when a turn ends; everything that touches
 *  the model, the balance or the database comes through here. */
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
  canAfford(estimatedInputTokens: number): Promise<boolean>;
  /** ONE model call. `text: null` = no usable summary (it called a tool, was cut, failed); `usage: null` =
   *  the provider reported nothing, so there is nothing to charge. */
  summarize(request: Message[], signal: AbortSignal): Promise<{ text: string | null; usage: IdleUsage | null }>;
  charge(usage: IdleUsage): Promise<void>;
  save(pending: PendingIdleSummary): Promise<void>;
}

export type IdleSummaryOutcome = "saved" | "small" | "unaffordable" | "no_summary" | "cancelled";

const warn = (key: string, what: string, err: unknown) =>
  console.warn(`[idle-summary] ${key}: ${what} — ${err instanceof Error ? err.message : String(err)}`);

/**
 * Writes one conversation's summary, now. `signal`: a newer turn of the conversation cancels it — whatever
 * is in flight is abandoned and nothing is saved.
 */
export async function runIdleSummary(job: IdleSummaryJob, signal: AbortSignal, now: () => Date = () => new Date()): Promise<IdleSummaryOutcome> {
  if (signal.aborted) return "cancelled";
  const tokens = estimateTokens(job.messages);
  if (tokens < job.minTokens) return "small";
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
    // Nothing comes back behind an idle summary (the turn's session is long closed): no skill is loaded
    // from here on, and `skill` gives it whole again when asked.
    skills: [],
  };
  await job.save({ mark, writtenAt: now().toISOString() });
  return "saved";
}

interface Waiting {
  timer: ReturnType<typeof setTimeout> | null;
  readonly controller: AbortController;
}

const waiting = new Map<string, Waiting>();

/** Arms a conversation's summary to be written `delayMs` from now. Arming it again replaces the one that
 *  was waiting. `false`: not armed — too many conversations are waiting already. */
export function armIdleSummary(job: IdleSummaryJob, delayMs: number): boolean {
  cancelIdleSummary(job.key);
  if (waiting.size >= IDLE_SUMMARY_MAX_ARMED) return false;
  const entry: Waiting = { timer: null, controller: new AbortController() };
  entry.timer = setTimeout(() => {
    entry.timer = null;
    void runIdleSummary(job, entry.controller.signal)
      .catch((err) => warn(job.key, "the summary could not be written", err))
      .finally(() => {
        if (waiting.get(job.key) === entry) waiting.delete(job.key);
      });
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
  entry.controller.abort();
  waiting.delete(key);
}

/** How many conversations are waiting for their summary or having it written. */
export function armedIdleSummaries(): number {
  return waiting.size;
}
