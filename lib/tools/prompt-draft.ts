// WHAT A TOOL'S `sendPrompt` BECOMES (spec local 2026-11-04-herramientas-hechas-por-len, §4.4): the workspace's composer
// and, since phase 5, the phone's. Pure.
/** What a tool's `sendPrompt` puts in Len's composer (§4.4): its text quoted, signed with the tool's name. */
export function toolPromptDraft(text: string, toolTitle: string): string {
  const quoted = text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `${quoted}\n\n— ${toolTitle}\n`;
}
