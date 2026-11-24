/**
 * THE PRIVATE CONTEXT OF WHOEVER ASKS A TURN, kept to them in a shared conversation.
 *
 * Each turn's context (`buildAgentContext`) carries three blocks that belong to the person asking: their
 * ~/.len/LEN.md, their own skills and their MCP servers. The row keeps the context as it was sent, so that
 * person's next turn still matches the provider's cache. A project's conversation is shared by its members,
 * though, and Claude Code and DeepSeek give each person a session of their own: when another person's turn
 * rebuilds the history, those three blocks come back as notes (`withoutPersonalContext`).
 *
 * The blocks' fixed words live here, and the three builders write them from here, so what is looked for is
 * what was written. The skills and the MCP servers are always the LAST two blocks of a context: they are cut
 * to its end, whatever an MCP server's instructions say.
 *
 * Pure.
 */

// Cache effect: a person's own turns come back byte for byte; only another person's turn sees the notes, and
// a change of who asks already changes what is sent (the context and the tools are theirs).
import { PRIVATE_MEMORY_NOTE } from "@/lib/agent/memory/private-memory";

/** How the speaker's ~/.len/LEN.md opens in the turn's context (`userMemoryBlock`). */
export const PERSONAL_MEMORY_HEAD = "WHAT YOU KNOW ABOUT THIS PERSON";
/** And how it closes, right after the file's text. */
export const PERSONAL_MEMORY_FOOT =
  "Respect it without them having to repeat it. If something here clashes with what they ask TODAY, today wins and you don't argue: the memory is a starting point, not a rule over them.\n" +
  "It belongs to the person speaking now: in a shared project each person has their own, so never quote it to anyone else on the project.\n\n";
/** How the speaker's own skills open (`personalSkillsReminder`). */
export const PERSONAL_SKILLS_HEAD =
  "<system-reminder>\nThe person you are talking to also has skills of their own, available through the `skill` tool in the same way:\n";
/** How the speaker's MCP servers open (`contextText` of `lib/mcp-connectors/turn.ts`). */
export const PERSONAL_CONNECTORS_HEAD = "<system-reminder>\nThe person's MCP servers (their ~/.len/mcp.json):\n";

/** What another person's turn reads where the skills and the MCP servers were. */
export const PERSONAL_TOOLS_NOTE =
  "[The skills and MCP servers of whoever was speaking in that turn are theirs: they are not shown in the shared conversation]\n";

/** A context as another person may read it: without the LEN.md, the skills or the MCP servers of whoever
 *  asked. A text without them comes back as it is. */
export function withoutPersonalContext(text: string): string {
  let out = text;
  const head = out.indexOf(PERSONAL_MEMORY_HEAD);
  if (head >= 0) {
    const foot = out.indexOf(PERSONAL_MEMORY_FOOT, head);
    // A head with no foot is not the block: there is nothing to cut that is known to be the memory.
    if (foot >= 0) out = `${out.slice(0, head)}${PRIVATE_MEMORY_NOTE}\n\n${out.slice(foot + PERSONAL_MEMORY_FOOT.length)}`;
  }
  const tails = [out.lastIndexOf(PERSONAL_SKILLS_HEAD), out.lastIndexOf(PERSONAL_CONNECTORS_HEAD)].filter((i) => i >= 0);
  if (tails.length > 0) out = `${out.slice(0, Math.min(...tails))}${PERSONAL_TOOLS_NOTE}`;
  return out;
}
