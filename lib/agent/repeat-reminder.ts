// The repeated-call reminder (A2 of Len 3.1), after DeepSeek's
// `repeat-tool-reminder` (deepseek-harness @ 22ddee3, MIT,
// LICENSES/deepseek-harness.MIT.txt: `packages/guard/repeat-tool-reminder/src/index.ts`).
// Advisory, never a veto: at 3, 5 and 8 consecutive identical calls (same tool,
// same arguments whatever their key order) the model gets a reminder after the
// results — gentle the first time, detailed after. A new message from the user
// clears the count. Their texts are kept as they are.
//
// Len's addition: the same counts for a PAIR of calls alternating with identical
// arguments and nothing else between (render → inspect → render → inspect on
// 23/10), which DeepSeek's chain misses because it breaks at every change. And a
// call whose answer says it is still waiting (`pending: true`, e.g. an export
// still rendering after `wait_ms`) is polling, not a loop: transparent, it
// neither counts nor breaks a chain.

// Cache effect: none on the prefix: the reminder is text appended after the step's tool results and saved with them.

export const REPEAT_THRESHOLDS: readonly number[] = [3, 5, 8];
const ARGUMENTS_PREVIEW_CHARS = 500;

const GENTLE_REMINDER =
  "You are repeating the exact same tool call with identical arguments. " +
  "Carefully analyze the previous result before calling again: if the task is " +
  "not complete, try a different approach or different arguments instead of " +
  "repeating the call.";

function detailedReminder(toolName: string, count: number, canonicalArguments: string): string {
  return (
    "Repeated tool call detected:\n" +
    `- tool: ${toolName}\n` +
    `- consecutive_calls: ${count}\n` +
    `- arguments: ${canonicalArguments}\n` +
    "The repeated calls are not making progress. Do not call this tool with " +
    "these exact arguments again. Inspect the latest result and choose a " +
    "different action, different arguments, or finish the task if enough " +
    "evidence has been gathered."
  );
}

const GENTLE_PAIR_REMINDER =
  "You are alternating the same two tool calls with identical arguments. " +
  "Carefully analyze the previous results before calling them again: if the task " +
  "is not complete, change something first (the sources, the arguments, the " +
  "approach) instead of repeating the pair.";

function detailedPairReminder(first: Call, second: Call, cycles: number): string {
  return (
    "Repeated pair of tool calls detected:\n" +
    `- tools: ${first.name}, then ${second.name}\n` +
    `- consecutive_cycles: ${cycles}\n` +
    `- arguments: ${first.name} ${preview(first.canonical)}; ${second.name} ${preview(second.canonical)}\n` +
    "The repeated pair is not making progress. Do not repeat these two calls with " +
    "these exact arguments again. Inspect the latest result and choose a " +
    "different action, different arguments, or finish the task if enough " +
    "evidence has been gathered."
  );
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) sorted[key] = sortJsonValue(record[key]);
    return sorted;
  }
  return value;
}

const preview = (canonical: string): string =>
  canonical.length <= ARGUMENTS_PREVIEW_CHARS ? canonical : `${canonical.slice(0, ARGUMENTS_PREVIEW_CHARS)}… (+${canonical.length - ARGUMENTS_PREVIEW_CHARS} more chars)`;

interface Call {
  readonly name: string;
  readonly canonical: string;
  readonly key: string;
}

export interface RepeatReminder {
  /** One batch of executed calls, in order, with their answers; returns the reminders to deliver. */
  observe(batch: readonly { readonly name: string; readonly args?: Record<string, unknown>; readonly response: Record<string, unknown> }[]): string[];
  /** A message from the user changes the context: repetition across it is not a loop. */
  reset(): void;
}

export function createRepeatReminder(thresholds: readonly number[] = REPEAT_THRESHOLDS): RepeatReminder {
  const hits = new Set(thresholds);
  let history: Call[] = [];
  const firedPairs = new Set<string>();

  return {
    observe(batch) {
      const out: string[] = [];
      for (const { name, args, response } of batch) {
        if (response.pending === true) continue;
        const canonical = JSON.stringify(sortJsonValue(args ?? {}));
        const call: Call = { name, canonical, key: JSON.stringify([name, canonical]) };
        history = [...history.slice(-31), call];
        const n = history.length;

        let identical = 0;
        for (let i = n - 1; i >= 0 && history[i]!.key === call.key; i--) identical++;
        if (hits.has(identical)) {
          out.push(identical === thresholds[0] ? GENTLE_REMINDER : detailedReminder(name, identical, preview(canonical)));
          continue;
        }

        const before = history[n - 2];
        if (!before || before.key === call.key) continue;
        let cycles = 0;
        for (let i = n - 1; i >= 1 && history[i]!.key === call.key && history[i - 1]!.key === before.key; i -= 2) cycles++;
        // The pair counts once per completed cycle, whichever of the two closes it.
        const pairKey = `${[before.key, call.key].sort().join("|")}#${cycles}`;
        if (hits.has(cycles) && !firedPairs.has(pairKey)) {
          firedPairs.add(pairKey);
          out.push(cycles === thresholds[0] ? GENTLE_PAIR_REMINDER : detailedPairReminder(before, call, cycles));
        }
      }
      return out;
    },
    reset() {
      history = [];
      firedPairs.clear();
    },
  };
}
