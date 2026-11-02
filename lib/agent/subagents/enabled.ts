// Len's subagents (spec local 2026-11-01-subagentes-de-len): the tool's name and the switch.
// On unless OPENLEN_SUBAGENTS=0, per server, like OPENLEN_SCHEDULE: the catalog doesn't change between turns.

/** DeepSeek's tool name (`packages/subagent/tool-subagent`, `toolName ?? 'subagent'`). */
export const SUBAGENT_TOOL = "subagent";
/** Phase 2: DeepSeek's fork tool and its shared control tools (`packages/subagent/tool-subagent-control`). */
export const SUBAGENT_FORK_TOOL = "subagent_fork";
export const SEND_MESSAGE_TOOL = "send_message";
export const INTERRUPT_AGENT_TOOL = "interrupt_agent";
export const LIST_AGENTS_TOOL = "list_agents";

export function subagentsEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.OPENLEN_SUBAGENTS !== "0";
}
