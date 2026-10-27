/**
 * THE LAYERS OF SKILLS (spec local 2026-10-26-len-skills, §4.2): OpenLen's, the project's and the
 * speaker's, in one set. On the same name the personal one wins over the project's, as in Claude Code
 * («enterprise > personal > project»); OpenLen's names are reserved, as Claude Code refuses a skill with
 * a reserved name, so a user skill with one never loads and says why. Which surface may offer each one
 * is DeepSeek's invocation policy (the model's catalog and tool; the user's `/` menu and `/name`).
 *
 * Pure.
 */
import type { BundledSkill } from "./bundled";
import { PERSONAL_SKILLS_DIR, PROJECT_SKILLS_DIR, type SkillScope } from "./paths";
import { parseSkillFile, type SkillDefinition } from "./skill-file";
import type { StoredSkill } from "./store";

export interface ResolvedSkill {
  readonly skill: SkillDefinition;
  readonly scope: "bundled" | SkillScope;
  /** The skill's folder, for its relative paths: `/.openlen/skills/x`, `/.len/skills/x`, `~/.len/skills/x`. */
  readonly baseDir: string;
}

export interface RefusedSkill {
  readonly name: string;
  readonly scope: SkillScope;
  readonly reason: "reserved" | "invalid";
  readonly error: string;
}

export interface SkillSet {
  /** Sorted by name. */
  readonly all: readonly ResolvedSkill[];
  readonly refused: readonly RefusedSkill[];
  get(name: string): ResolvedSkill | undefined;
  modelInvocable(): readonly ResolvedSkill[];
  userInvocable(): readonly ResolvedSkill[];
}

export const EMPTY_SKILL_SET: SkillSet = resolveSkills({ bundled: [], project: [], personal: [] });

export function resolveSkills(o: { bundled: readonly BundledSkill[]; project: readonly StoredSkill[]; personal: readonly StoredSkill[] }): SkillSet {
  const byName = new Map<string, ResolvedSkill>();
  const refused: RefusedSkill[] = [];
  for (const b of o.bundled) byName.set(b.skill.name, { skill: b.skill, scope: "bundled", baseDir: b.baseDir });
  const reserved = new Set(byName.keys());
  // Project first, then personal: the later one replaces, so personal wins.
  for (const [scope, list, dir] of [
    ["project", o.project, PROJECT_SKILLS_DIR],
    ["personal", o.personal, PERSONAL_SKILLS_DIR],
  ] as const) {
    for (const stored of list) {
      if (reserved.has(stored.name)) {
        refused.push({ name: stored.name, scope, reason: "reserved", error: `"${stored.name}" is one of OpenLen's own skills; this one does not load.` });
        continue;
      }
      const parsed = parseSkillFile(stored.text, stored.name);
      if (!parsed.ok) {
        refused.push({ name: stored.name, scope, reason: "invalid", error: parsed.error });
        continue;
      }
      byName.set(stored.name, { skill: parsed.skill, scope, baseDir: `${dir}${stored.name}` });
    }
  }
  const all = [...byName.values()].sort((a, b) => a.skill.name.localeCompare(b.skill.name));
  return {
    all,
    refused,
    get: (name) => byName.get(name),
    modelInvocable: () => all.filter((s) => s.skill.modelInvocable),
    userInvocable: () => all.filter((s) => s.skill.userInvocable),
  };
}
