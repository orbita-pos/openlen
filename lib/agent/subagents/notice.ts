// What Len reads about a subagent (spec local 2026-11-01-subagentes-de-len, §4.1 and §4.6): the start
// line and the settlement notice of DeepSeek Harness (`packages/subagent/tool-subagent/src/index.ts`
// and `packages/subagent/subagent/src/continuation-messages.ts` @ ce7073d, MIT,
// LICENSES/deepseek-harness.MIT.txt), in its «cannot be continued» form: phase 1 has no follow-up.
// The `budget` line is ours: DeepSeek has no spending limit.
//
// Pure: the launcher, the boot cleanup and the chat import it.
//
// Cache effect: the notice is a new user message appended after the reusable prefix; nothing above it changes.

/** How a child's run ended. */
export type SubagentStopReason = "completed" | "aborted" | "error" | "budget";

/** A run as `subagentRuns` keeps it. Here, not in the store, so the chat can import it. */
export type SubagentStatus = "running" | SubagentStopReason;

/** DeepSeek's start acknowledgement. */
export function startedLine(id: string): string {
  return `started subagent ${id}`;
}

/** DeepSeek's `settlementSummary` for a child that cannot receive follow-up messages. */
function summary(id: string, stopReason: SubagentStopReason): string {
  const subject = `Background subagent ${id}`;
  switch (stopReason) {
    case "completed":
      return `${subject} finished. It cannot receive follow-up messages.`;
    case "aborted":
      return `${subject} was stopped before it finished.`;
    case "error":
      return `${subject} failed before it finished.`;
    case "budget":
      return `${subject} stopped at the turn's spending limit before it finished.`;
  }
}

/** DeepSeek's `createSettlementMessage`, its blocks joined as one text. */
export function settlementNotice(o: { id: string; stopReason: SubagentStopReason; closingText: string; diagnostic?: string }): string {
  const closing = o.closingText.trim();
  return [
    summary(o.id, o.stopReason),
    closing === "" ? "It left no closing message." : `Its closing message:\n${closing}`,
    ...(o.diagnostic ? [o.diagnostic] : []),
  ].join("\n\n");
}
