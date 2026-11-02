// Len's subagents (spec local 2026-11-01-subagentes-de-len): the tool's name and the switch.
// On unless OPENLEN_SUBAGENTS=0, per server, like OPENLEN_SCHEDULE: the catalog doesn't change between turns.

/** DeepSeek's tool name (`packages/subagent/tool-subagent`, `toolName ?? 'subagent'`). */
export const SUBAGENT_TOOL = "subagent";

export function subagentsEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.OPENLEN_SUBAGENTS !== "0";
}
