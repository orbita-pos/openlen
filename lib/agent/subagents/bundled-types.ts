/**
 * OPENLEN'S OWN SUBAGENT TYPES (spec local 2026-11-02-subagentes-de-len-fase-4, §3): `len-design` and `len-office`,
 * as Claude Code ships its own (`statusline-setup`, `claude-code-guide`) next to `general-purpose`, `Explore` and
 * `Plan`. Written in the agent-file format of the project's types (`agent-file.ts`) and served read-only at
 * `/.openlen/agents/<name>.md`, as OpenLen's skills are at `/.openlen/skills/`. Their names are reserved
 * (`RESERVED_AGENT_TYPES`). The texts are ours.
 *
 * Here as strings, not files on disk: the registry and the `subagent` declaration stay pure and fixed.
 *
 * Cache effect: the fixed `subagent` declaration lists these two in `agent_preset` and in its description; they
 * change only when this file does.
 */
import { parseAgentFile, type AgentDefinition } from "./agent-file";

export const BUNDLED_AGENTS_DIR = "/.openlen/agents";

const LEN_DESIGN = `---
name: len-design
description: Designs or redesigns a page, a section or a screen of this project, following the business's brand when it has one, and looks at the result on desktop and mobile before answering with what it changed and where.
skills: brand
---

Design what Len asks for: a page, a section or a screen of this project. When the brand skill is loaded, follow it: its colors, type, logo, voice and tone are the business's.
Before you finish, look at the result with view_page, on desktop and on mobile, and fix what you see wrong.
Len gets only your final message: say what you changed and where — the files and the parts of the page.
`;

const LEN_OFFICE = `---
name: len-office
description: Makes or edits a Word, Excel, PowerPoint or PDF document, checks it, and answers with where it left the file (in /tmp/office) and what it contains; you deliver it. Never start it with isolation: its file would not come back.
skills: office, brand
---

Make or edit the document Len asks for. The office skill says which format skill to load; when the brand skill is loaded, the document follows it.
Check the document as its skill says, and leave the result in /tmp/office.
You don't deliver it: Len does. Len gets only your final message: give him the file's path and what it contains.
`;

const TEXTS: readonly (readonly [string, string])[] = [
  ["len-design", LEN_DESIGN],
  ["len-office", LEN_OFFICE],
];

export const BUNDLED_AGENT_TYPES: readonly AgentDefinition[] = TEXTS.map(([name, text]) => {
  const parsed = parseAgentFile(text, name);
  // Ours are checked by bundled-types.test: a broken one is a bug, never a type.
  if (!parsed.ok) throw new Error(`bundled agent type ${name}: ${parsed.error}`);
  return parsed.agent;
});

/** Every type's file, by the path Len reads it at. */
export function bundledAgentFiles(): Readonly<Record<string, string>> {
  return Object.fromEntries(TEXTS.map(([name, text]) => [`${BUNDLED_AGENTS_DIR}/${name}.md`, text]));
}
