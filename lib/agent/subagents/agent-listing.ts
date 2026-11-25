/**
 * THE AGENT LISTING DELTA — Claude Code's `agent_listing_delta` attachment (`normalizeAttachmentForAPI` words it):
 * in a message, never in the tool declarations. The `subagent` declaration never names the
 * project's or the speaker's custom types: they reach Len as a user message appended to the conversation, so creating,
 * editing or deleting `/.openlen/agents/*.md` or `~/.len/agents/*.md` never moves the tools in the cached prefix
 * (seen in production on 24/11: a `Write ~/.len/agents/language-teacher.md` changed `toolsHash` mid-turn and the next
 * call re-read the conversation, `causes=tools_changed`).
 *
 * As Claude Code: what was announced is folded from the conversation itself — the messages that carry an
 * `agentListing` — so a turn rebuilt from its row announces nothing twice, and what a summary took out of view is
 * announced again. Only names count: an edited description is not announced again. Ours: Claude Code's built-in types
 * and OpenLen's (`bundled-types.ts`) are constants of the fixed declaration, so they count as announced from the start
 * and a custom type always reads as new; the tool is named by its name here (`subagent`, Claude Code's `Agent`), and
 * the line keeps OpenLen's note on a personal type that covers the project's.
 *
 * Pure.
 */

// Cache effect: append-only — a new message behind the step that changed the types, never an edit of the declaration or of a message already sent.
import type { Message } from "@/lib/ai-gateway";

import type { AgentDefinition } from "./agent-file";
import type { AgentTypeSet } from "./agent-registry";
import { SUBAGENT_TOOL } from "./enabled";

/** What a delta message announced, kept with it in the row (Claude Code's `addedTypes` / `removedTypes`). */
export interface AgentListingDelta {
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

/** OpenLen's cap on a custom type's description in the list (it was the declaration's). */
export const AGENT_LISTING_DESCRIPTION_MAX = 500;

/** Claude Code's closing line, after a removal (the connector tools delta closes the same way). */
export const AMBIENT = "This is ambient context — do not narrate it to the user unless they ask or it is directly relevant to their request.";

/** As Claude Code folds them: the types the conversation has announced so far. */
export function announcedAgentTypes(messages: readonly Pick<Message, "agentListing">[]): Set<string> {
  const announced = new Set<string>();
  for (const m of messages) {
    if (!m.agentListing) continue;
    for (const name of m.agentListing.added) announced.add(name);
    for (const name of m.agentListing.removed) announced.delete(name);
  }
  return announced;
}

/** As Claude Code words it: what the type may use. */
function toolsOf(agent: AgentDefinition): string {
  const tools = agent.tools ?? [];
  if (tools.length > 0 && agent.disallowedTools.length > 0) {
    const denied = new Set(agent.disallowedTools);
    const left = tools.filter((t) => !denied.has(t));
    return left.length === 0 ? "None" : left.join(", ");
  }
  if (tools.length > 0) return tools.join(", ");
  if (agent.disallowedTools.length > 0) return `All tools except ${agent.disallowedTools.join(", ")}`;
  return "All tools";
}

/**
 * The delta for the conversation as it stands, or `null` when it already says it (as Claude Code decides it, in its
 * wording). Added: the custom types it has not announced, sorted; removed: the ones it announced that are gone.
 */
export function agentListingMessage(types: AgentTypeSet, messages: readonly Pick<Message, "agentListing">[]): Message | null {
  const announced = announcedAgentTypes(messages);
  const active = new Set(types.custom.map((t) => t.agent.name));
  const added = types.custom.filter((t) => !announced.has(t.agent.name)).sort((a, b) => a.agent.name.localeCompare(b.agent.name));
  const removed = [...announced].filter((name) => !active.has(name)).sort();
  if (added.length === 0 && removed.length === 0) return null;
  const parts: string[] = [];
  if (added.length > 0) {
    const lines = added.map(({ agent, covers }) => `- ${agent.name}${covers ? ` (yours, over the project's ${agent.name})` : ""}: ${agent.description.slice(0, AGENT_LISTING_DESCRIPTION_MAX)} (Tools: ${toolsOf(agent)})`);
    parts.push(`New agent types are now available for the ${SUBAGENT_TOOL} tool:\n${lines.join("\n")}`);
  }
  if (removed.length > 0) parts.push(`The following agent types are no longer available:\n${removed.map((name) => `- ${name}`).join("\n")}`, AMBIENT);
  return {
    role: "user",
    content: `<system-reminder>\n${parts.join("\n\n")}\n</system-reminder>`,
    agentListing: { added: added.map((t) => t.agent.name), removed },
  };
}
