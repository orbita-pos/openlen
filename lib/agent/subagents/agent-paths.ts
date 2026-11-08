/**
 * WHERE A PROJECT'S AND A PERSON'S SUBAGENT TYPES LIVE (spec local 2026-11-01-subagentes-de-len, §6), next to their
 * skills, as Claude Code keeps `.claude/agents/` next to `.claude/skills/`: `/.len/agents/<name>.md` (the project's)
 * and `~/.len/agents/<name>.md` (the speaker's).
 *
 * Pure.
 */
import { HOME_DIR } from "@/lib/agent/ficheros/len-md";
import type { SkillScope } from "@/lib/agent/skills/paths";
import { SKILL_NAME, SKILL_NAME_MAX } from "@/lib/agent/skills/skill-file";

/** The three types Claude Code ships (`presets.ts`, kept equal by agent-paths.test): a custom type can't take their names.
 *  Here, not in presets.ts, so the file tools can check it without importing every tool the presets name. */
export const BUILT_IN_AGENT_TYPES: ReadonlySet<string> = new Set(["general-purpose", "Explore", "Plan"]);
/** OpenLen's own types (`bundled-types.ts`, kept equal by bundled-types.test), reserved like its skills. */
export const OPENLEN_AGENT_TYPES: ReadonlySet<string> = new Set(["len-design", "len-office"]);
/** OpenLen's types that only OpenLen starts (the «Crear» card's `creator`): never listed for Len. */
export const HIDDEN_AGENT_TYPES: ReadonlySet<string> = new Set(["creator", "assistant", "assistant-visitor"]);
export const RESERVED_AGENT_TYPES: ReadonlySet<string> = new Set([...BUILT_IN_AGENT_TYPES, ...OPENLEN_AGENT_TYPES, ...HIDDEN_AGENT_TYPES]);

export const PROJECT_AGENTS_DIR = "/.len/agents/";
export const PERSONAL_AGENTS_DIR = `${HOME_DIR}/.len/agents/`;

const dirOf = (scope: SkillScope) => (scope === "project" ? PROJECT_AGENTS_DIR : PERSONAL_AGENTS_DIR);

/** A type's file, or null for anything else under the folder. */
export function agentPathOf(path: string): { scope: SkillScope; name: string } | null {
  for (const scope of ["project", "personal"] as const) {
    const dir = dirOf(scope);
    if (!path.startsWith(dir)) continue;
    const m = /^([^/]+)\.md$/.exec(path.slice(dir.length));
    if (!m || !SKILL_NAME.test(m[1]!) || m[1]!.length > SKILL_NAME_MAX) return null;
    return { scope, name: m[1]! };
  }
  return null;
}

/** Anything under an agents folder, valid or not: it is never the site's folder. */
export function isUnderAgentsDir(path: string): boolean {
  return path.startsWith(PROJECT_AGENTS_DIR) || path.startsWith(PERSONAL_AGENTS_DIR);
}

export function agentPath(scope: SkillScope, name: string): string {
  return `${dirOf(scope)}${name}.md`;
}

/** The refusal for anything under an agents folder that is not a type's file. Ours. */
export const ONLY_AGENT_MD = `A subagent type is one file: ${PROJECT_AGENTS_DIR}<name>.md for the project, ${PERSONAL_AGENTS_DIR}<name>.md for you. <name> is lowercase words joined by "-".`;
