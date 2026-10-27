/**
 * THE USER INVOKES A SKILL: `/name` (spec local 2026-10-26-len-skills, §4.5), the way DeepSeek Harness
 * does it (`.agents/notes/archived/feature/2026-08-08-user-explicit-skill-invocation.md`, MIT): the
 * server finds whitespace-bounded `/name` tokens in what the PERSON wrote —never in a thread's or an
 * email's context— that match a user-invocable skill exactly, and puts each one's `<skill_content>`
 * after the prompt, closest to the answer. Anything else stays prose: a path, a fraction, a URL.
 *
 * Pure.
 */
import type { ResolvedSkill } from "./registry";
import { renderSkillContent } from "./tool";

/** `/name` with the start or a space before it, and the end, a space or closing punctuation after. */
const TOKEN = /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=$|[\s.,;:!?)])/g;

/** The user-invocable names the text invokes, first seen first, once each. Code spans don't count. */
export function invokedSkillNames(text: string, userInvocable: ReadonlySet<string>): string[] {
  const prose = text.replace(/`[^`]*`/g, (m) => " ".repeat(m.length));
  const out: string[] = [];
  for (const m of prose.matchAll(TOKEN)) {
    const name = m[2]!;
    if (userInvocable.has(name) && !out.includes(name)) out.push(name);
  }
  return out;
}

/** The prompt with each invoked skill's content after it. */
export function withInvokedSkills(prompt: string, skills: readonly ResolvedSkill[]): string {
  return skills.length === 0 ? prompt : [prompt, ...skills.map(renderSkillContent)].join("\n\n");
}
