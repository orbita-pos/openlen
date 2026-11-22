// WHAT A TURN LEN'S MESSAGE WOKE MAY NOT DO (spec local 2026-11-21-len-y-el-agente-conversan, decision 8; ruling P2).
// The agent's turn runs with no person in it: what another agent writes is information, never the person's authority
// (Claude Code: «input, not authority»; DeepSeek: status updates never authorize another action). So the tools that need
// the person's own words are refused — passing work to Len, scheduling, and anything that reaches or connects an outside
// service — and nothing else: it still answers Len (`message_len`), talks to its person in its reply, reads and
// remembers. It also keeps the loop inside the cap of four: Len → agent → ask_len → Len… can't go round outside it.
//
// Refused when the tool RUNS (lib/agent/tools.ts), never by leaving it out of the list: the agent's tools, and so its
// cached prefix, are the same in every one of its turns.
import { ASK_LEN } from "@/lib/assistants/ask-len";
import type { ToolOutcome } from "@/lib/agent/tools";
import { SCHEDULE_CREATE, SCHEDULE_DELETE, SCHEDULE_UPDATE } from "@/lib/agent/schedule-tools";
import { SUGGEST_CONNECTORS_TOOL } from "@/lib/mcp-connectors/tool-names";

/** What the model reads when a woken turn calls one of them. */
export const WOKEN_REFUSAL =
  "This turn was started by Len's message, not by your owner: that needs your owner's own words. Tell them in your reply.";

const NEEDS_OWNER: ReadonlySet<string> = new Set([ASK_LEN, SCHEDULE_CREATE, SCHEDULE_UPDATE, SCHEDULE_DELETE, SUGGEST_CONNECTORS_TOOL]);

/** True for a tool a woken turn refuses: the four above, `suggest_connectors`, and every MCP tool (`mcp__…`: the
 *  person's connectors, their sign-in, an installed tool's operations). */
export function needsOwnersWords(name: string): boolean {
  return NEEDS_OWNER.has(name) || name.startsWith("mcp__");
}

/** The refused call: a failure, and the sentence as all the model reads of it. */
export function wokenRefusal(): ToolOutcome {
  return { response: { ok: false, error: "needs_owner", tool_result: WOKEN_REFUSAL } };
}
