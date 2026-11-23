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
export const NO_CHANGE_THRESHOLDS: readonly number[] = [3, 5];
export const REREAD_THRESHOLDS: readonly number[] = [3, 5];
const ARGUMENTS_PREVIEW_CHARS = 500;

const GENTLE_REMINDER =
  "You are repeating the exact same tool call with identical arguments. " +
  "Carefully analyze the previous result before calling again: if the task is " +
  "not complete, try a different approach or different arguments instead of " +
  "repeating the call.";

const USE_PAGE_NO_CHANGE_REMINDER =
  "Your last several use_page calls produced no observable change on the page (or failed). " +
  "Stop retrying similar browser interactions: inspect the page code or event handlers, fix the underlying cause, or report the blocker instead of looping.";

const REREAD_CIRCLING_REMINDER =
  "You are re-reading files you already read with no edits in between. " +
  "If you already have enough context, move on to editing, testing, or answering; if something specific is still missing, read only that missing location.";

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
  /** A message from the user changes the context, and so does a compaction that pruned or summarized what the model
   *  had read: repetition across it is not a loop. */
  reset(): void;
}

const MUTATING_TOOLS = new Set([
  "Edit", "MultiEdit", "Write", "bash", "edit_image", "toggle_module", "convert_to_app",
  // They change the project without saying which file, or through a child that may write: nothing read before them
  // is known to still be what Read would answer.
  "undo_last_change", "create_deliverable", "render_deliverable", "cancel_deliverable_job", "publish_artifact", "subagent", "subagent_fork",
]);
/** `artifact_data` write actions: reads (`get`, `list`, `query`) do not break circling streaks. */
const ARTIFACT_DATA_WRITES = new Set(["set", "update", "delete", "batch"]);

function isMutatingCall(name: string, args: Record<string, unknown> | undefined): boolean {
  if (MUTATING_TOOLS.has(name)) return true;
  return name === "artifact_data" && typeof args?.action === "string" && ARTIFACT_DATA_WRITES.has(args.action);
}
/** Of those, the ones whose arguments name the one file they changed; the rest (`edit_image` rewrites every file that
 *  holds the picture) may have changed any. */
const NAMES_ITS_FILE = new Set(["Edit", "MultiEdit", "Write"]);

export interface RepeatReminderOptions {
  /** The session cannot write (Explore, Plan, a read-only type, the person's own assistant): re-reading is how it
   *  works, so the reminder that tells it to move on to editing is never sent. */
  readonly readOnly?: boolean;
}

function readScopeKey(args: Record<string, unknown> | undefined): string | null {
  if (!args || typeof args.file_path !== "string" || args.file_path.trim() === "") return null;
  const offset = typeof args.offset === "number" ? args.offset : "";
  const limit = typeof args.limit === "number" ? args.limit : "";
  return `${args.file_path}#${offset}:${limit}`;
}

export function createRepeatReminder(thresholds: readonly number[] = REPEAT_THRESHOLDS, options: RepeatReminderOptions = {}): RepeatReminder {
  const hits = new Set(thresholds);
  const noChangeHits = new Set(NO_CHANGE_THRESHOLDS);
  const rereadHits = new Set(REREAD_THRESHOLDS);
  let history: Call[] = [];
  const firedPairs = new Set<string>();
  let usePageNoChangeStreak = 0;
  let rereadStreak = 0;
  const readScopes = new Set<string>();

  return {
    observe(batch) {
      const out: string[] = [];
      for (const { name, args, response } of batch) {
        if (response.pending === true) continue;
        const canonical = JSON.stringify(sortJsonValue(args ?? {}));
        const call: Call = { name, canonical, key: JSON.stringify([name, canonical]) };
        history = [...history.slice(-31), call];
        const n = history.length;

        // Track mutations: an edit/write/bash breaks both circling streaks and clears cached read scopes.
        const ok = response.ok !== false && response.isError !== true;
        if (isMutatingCall(name, args) && ok) {
          usePageNoChangeStreak = 0;
          rereadStreak = 0;
          if (!NAMES_ITS_FILE.has(name)) {
            readScopes.clear();
          } else if (typeof args?.file_path === "string") {
            const prefix = `${args.file_path}#`;
            for (const scope of readScopes) if (scope.startsWith(prefix)) readScopes.delete(scope);
          }
        }

        let emittedForStep = false;
        let identical = 0;
        for (let i = n - 1; i >= 0 && history[i]!.key === call.key; i--) identical++;
        if (hits.has(identical)) {
          out.push(identical === thresholds[0] ? GENTLE_REMINDER : detailedReminder(name, identical, preview(canonical)));
          emittedForStep = true;
        }

        if (!emittedForStep) {
          const before = history[n - 2];
          if (before && before.key !== call.key) {
            let cycles = 0;
            for (let i = n - 1; i >= 1 && history[i]!.key === call.key && history[i - 1]!.key === before.key; i -= 2) cycles++;
            // The pair counts once per completed cycle, whichever of the two closes it.
            const pairKey = `${[before.key, call.key].sort().join("|")}#${cycles}`;
            if (hits.has(cycles) && !firedPairs.has(pairKey)) {
              firedPairs.add(pairKey);
              out.push(cycles === thresholds[0] ? GENTLE_PAIR_REMINDER : detailedPairReminder(before, call, cycles));
              emittedForStep = true;
            }
          }
        }

        // Additive check 1 (A2): 3/5 consecutive use_page calls with no observable change (even with different args).
        if (name === "use_page") {
          const noChange = response.no_change === true || !ok;
          usePageNoChangeStreak = noChange ? usePageNoChangeStreak + 1 : 0;
          if (!emittedForStep && noChangeHits.has(usePageNoChangeStreak)) {
            out.push(USE_PAGE_NO_CHANGE_REMINDER);
            emittedForStep = true;
          }
        }

        // Additive check 2 (A2): circling on repeated Reads of already-read files with no edits in between.
        // Skip consecutive identical Reads (identical > 1): DeepSeek's identical-call detector already owns those.
        if (name === "Read" && ok && options.readOnly !== true) {
          const scope = readScopeKey(args);
          if (scope !== null) {
            if (readScopes.has(scope)) {
              if (identical === 1) {
                rereadStreak += 1;
                if (!emittedForStep && rereadHits.has(rereadStreak)) {
                  out.push(REREAD_CIRCLING_REMINDER);
                }
              }
            } else {
              readScopes.add(scope);
              rereadStreak = 0;
            }
          }
        }
      }
      return out;
    },
    reset() {
      history = [];
      firedPairs.clear();
      usePageNoChangeStreak = 0;
      rereadStreak = 0;
      readScopes.clear();
    },
  };
}
