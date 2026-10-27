/**
 * THE `skill` TOOL (spec local 2026-10-26-len-skills, §4.4): DeepSeek Harness's `skill({ name })`
 * (`packages/skill/tool-skill/src/index.ts`, MIT, LICENSES/deepseek-harness.MIT.txt): its name, its
 * description, its three errors and its `<skill_content>` answer (`renderSkillContent`, in
 * `packages/skill/skill/src/index.ts`). A skill already loaded in this conversation is not sent again:
 * Claude Code's line says so instead.
 *
 * Read-only: it counts against no write budget (`READ_ME`-like, `READ_ONLY_TOOLS` in loop.ts).
 */
import type { ResolvedSkill } from "./registry";
import { SKILL_NAME } from "./skill-file";

import type { AgentSession, ToolOutcome } from "@/lib/agent/tools";

export const SKILL_TOOL = "skill";

export const DECLARACION_SKILL = {
  name: SKILL_TOOL,
  description: "Load the full instructions for a skill. Call it before acting on a task that names or clearly matches a skill in the session skill catalog.",
  parameters: {
    type: "OBJECT",
    properties: {
      name: { type: "STRING", description: "The exact skill name from the available skills list." },
    },
    required: ["name"],
  },
} as const;

/** DeepSeek's `escapeAttr` and `escapeText`. */
const escapeAttr = (v: string) => v.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
const escapeText = (v: string) => v.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** DeepSeek's `renderSkillContent`, with a directory base. */
export function renderSkillContent(s: ResolvedSkill): string {
  return [
    `<skill_content name="${escapeAttr(s.skill.name)}">`,
    "<skill_resources>",
    `Base directory for this skill: ${escapeText(s.baseDir)}`,
    "Resolve relative paths mentioned by this skill against the base directory before using them. Load referenced resources only as needed.",
    "</skill_resources>",
    "",
    "<skill_instructions>",
    s.skill.body,
    "</skill_instructions>",
    "</skill_content>",
  ].join("\n");
}

/** Claude Code's answer when the skill is already in the conversation. */
export const alreadyLoaded = (name: string) => `Skill /${name} is already loaded above; instructions unchanged.`;

const CONTENT_OPEN = /<skill_content name="([a-z0-9-]+)">/g;

/** The skills the resent history already shows in full: a `skill` answer with its `<skill_content>`,
 *  or one injected in a message by /name. What compaction or the window left out is not counted, so
 *  it loads again. */
export function skillsLoadedIn(
  history: readonly { readonly content?: unknown; readonly functionResponses?: readonly { readonly name: string; readonly response: Record<string, unknown> }[] }[],
): Set<string> {
  const loaded = new Set<string>();
  const scan = (text: unknown) => {
    if (typeof text !== "string") return;
    for (const m of text.matchAll(CONTENT_OPEN)) loaded.add(m[1]!);
  };
  for (const m of history) {
    scan(m.content);
    for (const r of m.functionResponses ?? []) if (r.name === SKILL_TOOL && r.response.ok === true) scan(r.response.tool_result);
  }
  return loaded;
}

export function toolSkill(session: AgentSession, args: Record<string, unknown>): ToolOutcome {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  if (!SKILL_NAME.test(name)) return { response: { ok: false, error: `invalid skill name "${String(args.name ?? "")}"` } };
  const found = session.skills?.get(name);
  if (!found) return { response: { ok: false, error: `skill "${name}" is unknown or no longer available` } };
  if (!found.skill.modelInvocable) return { response: { ok: false, error: `skill "${name}" is not available for model invocation` } };
  const loaded = (session.loadedSkills ??= new Set());
  if (loaded.has(name)) return { response: { ok: true, tool_result: alreadyLoaded(name) } };
  loaded.add(name);
  return { response: { ok: true, tool_result: renderSkillContent(found) }, action: { tool: SKILL_TOOL, ok: true, summary: name } };
}
