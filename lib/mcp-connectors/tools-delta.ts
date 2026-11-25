/**
 * THE CONNECTOR TOOLS DELTA — what Claude Code does when the tools change mid-conversation (in 2.1.330: a message that
 * names the tools that became available, the ones no longer available and the ones back, never a silent change of the
 * declarations), for the tools a person's connectors give a turn (lib/mcp-connectors/turn.ts): a server signs in or is
 * removed, a sign-in lapses, the project is shared and they all go. Those change only between turns, and the
 * declarations change with them; what the model reads in the conversation did not. Seen on 25/11 in production: with
 * Google Calendar's nine tools declared, Len read an earlier failure in the history, told the person the tools «hadn't
 * arrived» and inspected ~/.len/mcp.json instead of calling them; the same tools in a fresh chat were called at once
 * (the same `toolsHash` in both). DeepSeek's harness has no such notice; Claude Code is the reference.
 *
 * As the agent listing (lib/agent/subagents/agent-listing.ts): what was announced is folded from the conversation itself
 * — the messages that carry `connectorTools` — so a turn rebuilt from its row announces nothing twice, and a conversation
 * that never announced its tools announces them once. Only names count. Behaviour from Claude Code, wording ours.
 *
 * Pure.
 */

// Cache effect: append-only — a new user message at the end of the conversation, never an edit of the declarations or of a message already sent.
import type { Message } from "@/lib/ai-gateway";
import { AMBIENT } from "@/lib/agent/subagents/agent-listing";

/** The tools the conversation has announced so far, folded from its messages in order. */
export function announcedConnectorTools(messages: readonly Pick<Message, "connectorTools">[]): Set<string> {
  const announced = new Set<string>();
  for (const m of messages) {
    if (!m.connectorTools) continue;
    for (const name of m.connectorTools.added) announced.add(name);
    for (const name of m.connectorTools.removed) announced.delete(name);
  }
  return announced;
}

/**
 * The delta for the conversation as it stands, or `null` when it already says it. Added: the connector tools declared
 * now that it hasn't announced, sorted; removed: the ones it announced that are not declared now.
 */
export function connectorToolsMessage(declared: readonly string[], messages: readonly Pick<Message, "connectorTools">[]): Message | null {
  const announced = announcedConnectorTools(messages);
  const now = new Set(declared);
  const added = [...now].filter((name) => !announced.has(name)).sort();
  const removed = [...announced].filter((name) => !now.has(name)).sort();
  if (added.length === 0 && removed.length === 0) return null;
  const parts: string[] = [];
  const list = (names: readonly string[]) => names.map((name) => `- ${name}`).join("\n");
  if (added.length > 0) parts.push(`These tools from the person's connectors are available from now on; call them directly when they help:\n${list(added)}`);
  if (removed.length > 0) parts.push(`These connector tools are no longer available; don't call them:\n${list(removed)}`, AMBIENT);
  return {
    role: "user",
    content: `<system-reminder>\n${parts.join("\n\n")}\n</system-reminder>`,
    connectorTools: { added, removed },
  };
}
