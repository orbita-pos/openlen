/**
 * WHERE A PROJECT'S AND A PERSON'S SKILLS LIVE (spec local 2026-10-26-len-skills, §4.2), next to Len's
 * memory as Claude Code and DeepSeek put theirs next to theirs: `/.len/skills/<name>/SKILL.md` (the
 * project's, like `/LEN.md`) and `~/.len/skills/<name>/SKILL.md` (the speaker's, like `~/.len/LEN.md`).
 * In this phase a user skill is only its SKILL.md: a script would run in the box with their rights.
 *
 * Pure.
 */
import { HOME_DIR } from "@/lib/agent/ficheros/len-md";

import { SKILL_NAME, SKILL_NAME_MAX } from "./skill-file";

export const PROJECT_SKILLS_DIR = "/.len/skills/";
export const PERSONAL_SKILLS_DIR = `${HOME_DIR}/.len/skills/`;

export type SkillScope = "project" | "personal";

const dirOf = (scope: SkillScope) => (scope === "project" ? PROJECT_SKILLS_DIR : PERSONAL_SKILLS_DIR);

/** A user skill's SKILL.md, or null for anything else (a script next to it included). */
export function skillPathOf(path: string): { scope: SkillScope; name: string } | null {
  for (const scope of ["project", "personal"] as const) {
    const dir = dirOf(scope);
    if (!path.startsWith(dir)) continue;
    const m = /^([^/]+)\/SKILL\.md$/.exec(path.slice(dir.length));
    if (!m || !SKILL_NAME.test(m[1]!) || m[1]!.length > SKILL_NAME_MAX) return null;
    return { scope, name: m[1]! };
  }
  return null;
}

/** Anything under a skills folder, valid or not: it is never the site's folder. */
export function isUnderSkillsDir(path: string): boolean {
  return path.startsWith(PROJECT_SKILLS_DIR) || path.startsWith(PERSONAL_SKILLS_DIR);
}

export function skillPath(scope: SkillScope, name: string): string {
  return `${dirOf(scope)}${name}/SKILL.md`;
}

/** The refusal for anything under a skills folder that is not a SKILL.md. */
export const ONLY_SKILL_MD = `User skills are only a SKILL.md: ${PROJECT_SKILLS_DIR}<name>/SKILL.md for the project, ${PERSONAL_SKILLS_DIR}<name>/SKILL.md for you. <name> is lowercase words joined by "-".`;
