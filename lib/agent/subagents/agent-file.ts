/**
 * THE FILE OF A CUSTOM SUBAGENT TYPE (spec local 2026-11-01-subagentes-de-len, §6): `<name>.md`, a frontmatter and
 * the type's section, like Claude Code's `.claude/agents/*.md`. The keys are a subset of Claude Code's: `name`,
 * `description`, `tools`, `disallowedTools`, `skills`, `effort`, `maxTurns` and `omitLenMd` (its `omitClaudeMd`);
 * the others (`model`, `color`…) are ignored, not refused, as the skills do. A key that grants or limits something
 * and is malformed drops the type: ignoring it would change what the type may do.
 *
 * Read like a SKILL.md (`lib/agent/skills/skill-file.ts`): line by line, `key: value`; lists on one line, comma
 * separated, optionally in `[...]`.
 *
 * Pure.
 */
import { findSecret } from "@/lib/agent/memory/secrets";
import { NIVELES, type NivelEsfuerzo } from "@/lib/agent/esfuerzo";
import { SKILL_NAME, SKILL_NAME_MAX } from "@/lib/agent/skills/skill-file";

export const AGENT_BODY_MAX = 20_000;
/** Claude Code preloads up to 32 skills in an agent. */
export const AGENT_SKILLS_MAX = 32;
export const AGENT_MAX_TURNS_MAX = 200;

export interface AgentDefinition {
  readonly name: string;
  readonly description: string;
  /** The tools it may use; `null` = every tool a child gets. */
  readonly tools: readonly string[] | null;
  readonly disallowedTools: readonly string[];
  /** Preloaded in full before its first call. */
  readonly skills: readonly string[];
  readonly effort: NivelEsfuerzo | null;
  /** Model calls before it must answer. */
  readonly maxTurns: number | null;
  /** Without `/LEN.md` and the person's notes (Claude Code's `omitClaudeMd`). */
  readonly omitLenMd: boolean;
  /** The type's section. */
  readonly body: string;
}

const TRUE = new Set(["true", "yes", "on", "1"]);
const FALSE = new Set(["false", "no", "off", "0"]);
const ITEM = /^[A-Za-z_][\w-]*$/;
const KEYS = new Set(["name", "description", "tools", "disallowedTools", "skills", "effort", "maxTurns", "omitLenMd"]);

function template(name: string): string {
  return `---\nname: ${name}\ndescription: <what it does and when to use it, in one line>\ntools: Read, Grep, Glob\n---\n\n<the instructions for this type of subagent>\n`;
}

const unquote = (v: string) => (/^(["']).*\1$/.test(v) ? v.slice(1, -1) : v);

/** A one-line list: `a, b` or `[a, b]`. `null` if an item is malformed. */
function list(v: string | undefined): string[] | null {
  if (v === undefined) return [];
  const inner = v.replace(/^\[(.*)\]$/, "$1").trim();
  if (inner === "") return [];
  const items = inner.split(",").map((s) => unquote(s.trim()));
  return items.every((s) => ITEM.test(s)) ? items : null;
}

export function parseAgentFile(text: string, expectedName: string | null): { ok: true; agent: AgentDefinition } | { ok: false; error: string } {
  const t = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const shown = expectedName ?? "my-agent";
  const fail = (why: string) => ({ ok: false as const, error: `${why} A subagent type looks like this:\n${template(shown)}` });
  if (!t.startsWith("---\n")) return fail("The type has no frontmatter.");
  const end = t.indexOf("\n---\n", 4);
  if (end < 0) return fail("The frontmatter is not closed with ---.");
  const fields = new Map<string, string>();
  let previous: string | null = null;
  for (const line of t.slice(4, end).split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const m = /^([A-Za-z][A-Za-z_-]*):\s*(.*)$/.exec(line);
    if (!m) {
      const attempted = /^\s*([A-Za-z][A-Za-z_-]*)\b/.exec(line)?.[1];
      if ((previous && KEYS.has(previous)) || (attempted && KEYS.has(attempted))) {
        return fail("Use one-line key: value fields. Lists must be comma-separated on the same line; multiline fields are not supported.");
      }
      continue;
    }
    previous = m[1]!;
    fields.set(previous, unquote(m[2]!.trim()));
  }
  const name = fields.get("name") ?? "";
  if (expectedName !== null && name !== expectedName) return fail(`name must be "${expectedName}", the file's name.`);
  if (!SKILL_NAME.test(name) || name.length > SKILL_NAME_MAX) return fail(`name must be lowercase words joined by "-", up to ${SKILL_NAME_MAX} characters.`);
  const description = fields.get("description") ?? "";
  if (!description) return fail("description is required: one line on what the type does and when to use it.");
  const tools = fields.has("tools") ? list(fields.get("tools")) : null;
  if (fields.has("tools") && tools === null) return fail("tools must be tool names separated by commas.");
  const disallowedTools = list(fields.get("disallowedTools"));
  if (disallowedTools === null) return fail("disallowedTools must be tool names separated by commas.");
  const skills = list(fields.get("skills"));
  if (skills === null) return fail("skills must be skill names separated by commas.");
  if (skills.length > AGENT_SKILLS_MAX) return fail(`skills can preload up to ${AGENT_SKILLS_MAX}.`);
  const effortText = fields.get("effort");
  const effort = effortText === undefined ? null : (NIVELES as readonly string[]).includes(effortText) ? (effortText as NivelEsfuerzo) : undefined;
  if (effort === undefined) return fail(`effort must be one of ${NIVELES.join(", ")}.`);
  const turnsText = fields.get("maxTurns");
  const maxTurns = turnsText === undefined ? null : /^\d+$/.test(turnsText) ? Number(turnsText) : NaN;
  if (maxTurns !== null && !(maxTurns >= 1 && maxTurns <= AGENT_MAX_TURNS_MAX)) return fail(`maxTurns must be a whole number from 1 to ${AGENT_MAX_TURNS_MAX}.`);
  const omitText = fields.get("omitLenMd")?.toLowerCase();
  const omitLenMd = omitText === undefined ? false : TRUE.has(omitText) ? true : FALSE.has(omitText) ? false : null;
  if (omitLenMd === null) return fail("omitLenMd must be true or false.");
  const body = t.slice(end + "\n---\n".length).trim();
  if (!body) return fail("The type has no instructions after the frontmatter.");
  if (body.length > AGENT_BODY_MAX) return fail(`The instructions are longer than ${AGENT_BODY_MAX} characters.`);
  const secret = findSecret(`${description}\n${body}`);
  if (secret) return { ok: false, error: `The type seems to contain a ${secret}. Never save credentials in a subagent type.` };
  return { ok: true, agent: { name, description, tools, disallowedTools, skills, effort, maxTurns, omitLenMd, body } };
}
