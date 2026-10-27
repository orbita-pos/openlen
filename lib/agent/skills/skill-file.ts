/**
 * THE FILE OF A SKILL (spec local 2026-10-26-len-skills, §4.1): `<name>/SKILL.md`, a frontmatter and
 * the instructions, as DeepSeek Harness (`packages/skill/skill-filesystem`, MIT) and Claude Code read
 * it. The keys are the ones DeepSeek implements, a subset of Claude Code's; the others (allowed-tools,
 * argument-hint, context…) are ignored, not refused. An invocation key that is not a boolean drops the
 * skill: ignoring it would grant permission by default (DeepSeek: «Invocation data fails closed»).
 *
 * The frontmatter is read line by line, `key: value`, like a memory note (`lib/agent/memory/note.ts`).
 *
 * Pure.
 */
import { findSecret } from "@/lib/agent/memory/secrets";

export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SKILL_NAME_MAX = 64;
export const SKILL_BODY_MAX = 20_000;

export interface SkillDefinition {
  readonly name: string;
  /** With `when_to_use` after it, as the catalog shows it. */
  readonly description: string;
  readonly modelInvocable: boolean;
  readonly userInvocable: boolean;
  /** The instructions, without the frontmatter. */
  readonly body: string;
}

/** DeepSeek's boolean spellings, which match Claude's skills. */
const TRUE = new Set(["true", "yes", "on", "1"]);
const FALSE = new Set(["false", "no", "off", "0"]);

function template(name: string): string {
  return `---\nname: ${name}\ndescription: <what it does and when to use it, in one line>\n---\n\n<the instructions>\n`;
}

const unquote = (v: string) => (/^(["']).*\1$/.test(v) ? v.slice(1, -1) : v);

export function parseSkillFile(text: string, expectedName: string | null): { ok: true; skill: SkillDefinition } | { ok: false; error: string } {
  const t = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const shown = expectedName ?? "my-skill";
  const fail = (why: string) => ({ ok: false as const, error: `${why} A skill looks like this:\n${template(shown)}` });
  if (!t.startsWith("---\n")) return fail("The skill has no frontmatter.");
  const end = t.indexOf("\n---\n", 4);
  if (end < 0) return fail("The frontmatter is not closed with ---.");
  const fields = new Map<string, string>();
  for (const line of t.slice(4, end).split("\n")) {
    const m = /^([a-z][a-z_-]*):\s*(.*)$/.exec(line);
    if (m) fields.set(m[1]!, unquote(m[2]!.trim()));
  }
  const name = fields.get("name") ?? "";
  if (expectedName !== null && name !== expectedName) return fail(`name must be "${expectedName}", the folder's name.`);
  if (!SKILL_NAME.test(name) || name.length > SKILL_NAME_MAX) {
    return fail(`name must be lowercase words joined by "-", up to ${SKILL_NAME_MAX} characters.`);
  }
  const flag = (key: string, fallback: boolean): boolean | null => {
    const v = fields.get(key);
    if (v === undefined) return fallback;
    const low = v.toLowerCase();
    return TRUE.has(low) ? true : FALSE.has(low) ? false : null;
  };
  const disableModel = flag("disable-model-invocation", false);
  const userInvocable = flag("user-invocable", true);
  if (disableModel === null) return fail("disable-model-invocation must be true or false.");
  if (userInvocable === null) return fail("user-invocable must be true or false.");
  const description = [fields.get("description") ?? "", fields.get("when_to_use") ?? ""].filter(Boolean).join(" ");
  if (!fields.get("description")) return fail("description is required: one line on what the skill does and when to use it.");
  const body = t.slice(end + "\n---\n".length).trim();
  if (!body) return fail("The skill has no instructions after the frontmatter.");
  if (body.length > SKILL_BODY_MAX) return fail(`The instructions are longer than ${SKILL_BODY_MAX} characters.`);
  const secret = findSecret(`${description}\n${body}`);
  if (secret) return { ok: false, error: `The skill seems to contain a ${secret}. Never save credentials in a skill.` };
  return { ok: true, skill: { name, description, modelInvocable: !disableModel, userInvocable, body } };
}
