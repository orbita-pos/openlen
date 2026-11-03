// What Len reads about a subagent (spec local 2026-11-01-subagentes-de-len, §4.1, §4.6 and §5): the start
// line, the settlement notice, the messages between agents and the return guidance of DeepSeek Harness
// (`packages/subagent/tool-subagent/src/index.ts` and `packages/subagent/subagent/src/continuation-messages.ts`
// @ ce7073d, MIT, LICENSES/deepseek-harness.MIT.txt), in its continuable form: since phase 2 every child
// accepts `send_message`. The `budget` line is ours: DeepSeek has no spending limit.
//
// Pure: the launcher, the boot cleanup and the chat import it.
//
// Cache effect: the notice is a new user message appended after the reusable prefix; nothing above it changes.

/** How a child's run ended. */
export type SubagentStopReason = "completed" | "aborted" | "error" | "budget" | "turn_limit";

/** A run as `subagentRuns` keeps it. Here, not in the store, so the chat can import it. */
export type SubagentStatus = "running" | SubagentStopReason;

/** Len's agent id, as his children address him (`send_message({ agent_id: "len" })`). DeepSeek's is the
 *  parent's session id; Len has one conversation in progress per project. */
export const LEN_AGENT_ID = "len";

/** DeepSeek's start acknowledgement. */
export function startedLine(id: string): string {
  return `started subagent ${id}`;
}

/** DeepSeek's `settlementSummary` for a continuable child. */
function summary(id: string, stopReason: SubagentStopReason): string {
  const subject = `Background subagent ${id}`;
  switch (stopReason) {
    case "completed":
      return `${subject} finished and will do no further work unless you send it more.`;
    case "aborted":
      return `${subject} was stopped before it finished.`;
    case "error":
      return `${subject} failed before it finished.`;
    case "budget":
      return `${subject} stopped at the turn's spending limit before it finished.`;
    case "turn_limit":
      return `${subject} stopped at its turn limit before it finished.`;
  }
}

/** DeepSeek's `createSettlementMessage`, its blocks joined as one text. `omitClosingText`: the child's last
 *  act was a `send_message` to Len, which already carries it. */
export function settlementNotice(o: {
  id: string;
  stopReason: SubagentStopReason;
  closingText: string;
  diagnostic?: string;
  omitClosingText?: boolean;
}): string {
  const closing = o.closingText.trim();
  return [
    summary(o.id, o.stopReason),
    o.omitClosingText
      ? "It sent you a message just before finishing, so its closing message is omitted."
      : closing === ""
        ? "It left no closing message."
        : `Its closing message:\n${closing}`,
    ...(o.diagnostic ? [o.diagnostic] : []),
  ].join("\n\n");
}

/** DeepSeek's `createAgentMessage`: what one agent says to another, as the recipient reads it. */
export function agentMessage(senderId: string, text: string): string {
  return `Agent ${senderId} sent a message: ${text}`;
}

/** DeepSeek's `withContinuableReturnGuidance`, appended to a child's task so it reports to its parent. */
export function withContinuableReturnGuidance(prompt: string, parentId: string = LEN_AGENT_ID): string {
  const p = JSON.stringify(parentId);
  return `${prompt}\n\nYour parent agent id is ${p}. Before you finish, send your result to that agent with send_message({ agent_id: ${p}, message: "<self-contained result>" }). The parent shares your workspace but does not automatically receive your transcript, tool output, or reasoning. Send earlier messages as well when a finding changes what the parent should do next; sending a message does not end your turn.`;
}
