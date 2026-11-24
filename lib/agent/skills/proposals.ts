/**
 * THE CONTRACT OF `propose_skills` (spec local 2026-11-19-agentes-para-todos, §6.6), after Claude Code's tool
 * of the same name (its contract, not its words): Len never writes the person's own skills; he proposes up to three on a
 * review card and the person saves them. A new skill brings its whole SKILL.md; an improvement of one of the person's
 * skills brings `edits` (`old_string` → `new_string`, each found exactly once, applied in order) on the SKILL.md Len read,
 * or a whole new SKILL.md. The saved file takes its name and description from the fields; other frontmatter keys are not
 * kept. OpenLen's own skills are never the person's to change: a customized one is saved as a new skill with its own name.
 *
 * Pure: what the person has, OpenLen's names and what Len read come in `ctx`.
 */
import { createHash } from "node:crypto";

// `parseSkillFile` refuses a credential (`findSecret`), as it does for every skill Len writes.
import { MAX_SKILLS_PER_SCOPE, parseSkillFile, SKILL_NAME, SKILL_NAME_MAX } from "./skill-file";

export const MAX_PROPOSALS = 3;
export const PROPOSAL_DESCRIPTION_MAX = 1024;
export const MAX_EDITS = 100;

export interface SkillEdit {
  old_string: string;
  new_string: string;
}

export interface SkillProposalInput {
  name: string;
  kind: "new" | "improvement";
  target?: string;
  description: string;
  evidence?: string[];
  edits?: SkillEdit[];
  skillMd?: string;
}

export interface ResolvedProposal {
  name: string;
  kind: "new" | "improvement";
  target: string | null;
  description: string;
  /** The whole file as it would be saved. */
  skillMd: string;
  /** `skillFingerprint` of the text the improvement was made on; null for a new skill. */
  base: string | null;
  /** `skillFingerprint(skillMd)`: the card compares it with the saved skill's, so a reload knows it was saved. */
  fingerprint: string;
}

/** What Len knows of a skill's current SKILL.md: read as it is now, never read, or read before it changed. */
export type ReadState = "read" | "unread" | "stale";

export interface ProposalContext {
  /** The person's own skills: name → current SKILL.md. */
  readonly personal: ReadonlyMap<string, string>;
  /** OpenLen's skill names. */
  readonly bundled: ReadonlySet<string>;
  readonly readState: (name: string) => ReadState;
}

const lf = (text: string) => text.replace(/^﻿/, "").replace(/\r\n/g, "\n");

/** sha256 hex of the text with its line ends as LF. */
export function skillFingerprint(text: string): string {
  return createHash("sha256").update(lf(text)).digest("hex");
}

export function applyEdits(text: string, edits: readonly SkillEdit[]): { ok: true; text: string } | { ok: false; edit: number; repeated: boolean } {
  let running = lf(text);
  for (const [i, e] of edits.entries()) {
    const from = lf(e.old_string);
    const at = running.indexOf(from);
    if (at === -1) return { ok: false, edit: i + 1, repeated: false };
    if (running.indexOf(from, at + 1) !== -1) return { ok: false, edit: i + 1, repeated: true };
    running = running.slice(0, at) + lf(e.new_string) + running.slice(at + from.length);
  }
  return { ok: true, text: running };
}

/** The instructions below the frontmatter (the whole text when there is none). */
function bodyOf(text: string): string {
  const t = lf(text);
  if (!t.startsWith("---\n")) return t.trim();
  const end = t.indexOf("\n---", 4);
  if (end < 0) return t.trim();
  return t.slice(end + 4).replace(/^[^\n]*\n?/, "").trim();
}

const saved = (name: string, description: string, body: string) => `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;

/** Why this name can't be one of the person's skills, or null. */
function nameProblem(name: string, bundled: ReadonlySet<string>): string | null {
  if (!SKILL_NAME.test(name)) return `"${name}" must be lowercase words joined by "-".`;
  if (name.length > SKILL_NAME_MAX) return `"${name}" is longer than ${SKILL_NAME_MAX} characters.`;
  for (const word of ["claude", "anthropic"]) if (name.includes(word)) return `"${name}" may not contain "${word}".`;
  if (bundled.has(name)) {
    return `"${name}" is one of OpenLen's own skills, which can't be changed from the card: propose a new skill under a name of its own, with a description that says when to use it instead.`;
  }
  return null;
}

/** Why this SKILL.md can't be saved as the person's skill `name`, or null. */
export function checkSkillText(name: string, skillMd: string, bundled: ReadonlySet<string>): string | null {
  const named = nameProblem(name, bundled);
  if (named) return named;
  const parsed = parseSkillFile(skillMd, name);
  return parsed.ok ? null : parsed.error;
}

function descriptionProblem(d: unknown): string | null {
  if (typeof d !== "string" || !d.trim()) return "description is required: one short sentence saying when to use the skill.";
  if (d.length > PROPOSAL_DESCRIPTION_MAX) return `description is longer than ${PROPOSAL_DESCRIPTION_MAX} characters: one short sentence saying when to use the skill.`;
  if (/[<>]/.test(d)) return "description contains angle brackets, which a saved skill's description can't hold: reword it without them.";
  if (/[\r\n]/.test(d)) return "description must be one line.";
  return null;
}

const isEdit = (e: unknown): e is SkillEdit =>
  typeof e === "object" && e !== null && typeof (e as SkillEdit).old_string === "string" && (e as SkillEdit).old_string !== "" && typeof (e as SkillEdit).new_string === "string";

function resolveOne(p: Record<string, unknown>, ctx: ProposalContext): ResolvedProposal | string {
  const name = typeof p.name === "string" ? p.name : "";
  const named = nameProblem(name, ctx.bundled);
  if (named) return named;
  const described = descriptionProblem(p.description);
  if (described) return described;
  const description = (p.description as string).trim();
  const edits = p.edits === undefined ? undefined : Array.isArray(p.edits) && p.edits.every(isEdit) ? (p.edits as SkillEdit[]) : null;
  if (edits === null || (edits && (edits.length === 0 || edits.length > MAX_EDITS))) {
    return `edits must be 1 to ${MAX_EDITS} objects with a non-empty old_string and a new_string.`;
  }
  const skillMd = typeof p.skillMd === "string" ? p.skillMd : undefined;
  let body: string;
  let base: string | null = null;
  let target: string | null = null;
  if (p.kind === "new") {
    if (edits) return "A new skill takes no edits: send its whole skillMd.";
    if (skillMd === undefined) return "A new skill needs skillMd: its whole SKILL.md.";
    if (ctx.personal.has(name)) return `The person already has a skill named "${name}": propose it as an improvement with target "${name}", or give the new one another name.`;
    body = bodyOf(skillMd);
  } else if (p.kind === "improvement") {
    if (typeof p.target !== "string" || !p.target) return "An improvement needs target: the name of the person's skill it changes.";
    target = p.target;
    if (name !== target) return `An improvement keeps the name of its target ("${target}").`;
    const current = ctx.personal.get(target);
    if (current === undefined) return `"${target}" is not one of the person's own skills: only their own skills can be improved. Propose a new skill instead.`;
    if (!edits && skillMd === undefined) return "An improvement needs edits or skillMd.";
    const state = ctx.readState(target);
    if (state === "unread") return `read ~/.len/skills/${target}/SKILL.md first, then propose your changes to it.`;
    if (state === "stale") return `~/.len/skills/${target}/SKILL.md changed since you read it: read it again.`;
    base = skillFingerprint(current);
    if (edits) {
      const applied = applyEdits(current, edits);
      if (!applied.ok) {
        return applied.repeated
          ? `edit ${applied.edit}: its old_string occurs more than once in the SKILL.md; include more of the text around it.`
          : `edit ${applied.edit}: its old_string is not in the SKILL.md as it is now.`;
      }
      body = bodyOf(applied.text);
    } else {
      body = bodyOf(skillMd!);
    }
  } else {
    return 'kind must be "new" or "improvement".';
  }
  if (!body) return "skillMd has no instructions below its frontmatter, so the card can't save it: send the complete SKILL.md.";
  const text = saved(name, description, body);
  const problem = checkSkillText(name, text, ctx.bundled);
  if (problem) return problem;
  return { name, kind: p.kind, target, description, skillMd: text, base, fingerprint: skillFingerprint(text) };
}

export function resolveProposals(input: unknown, ctx: ProposalContext): { ok: true; proposals: ResolvedProposal[] } | { ok: false; error: string } {
  const list = (input as { proposals?: unknown } | null)?.proposals;
  if (!Array.isArray(list)) return { ok: false, error: "proposals is required: a list of one to 3 skills." };
  if (list.length < 1 || list.length > MAX_PROPOSALS) return { ok: false, error: `Send one to ${MAX_PROPOSALS} proposals in one call.` };
  const names = list.map((p) => (p as { name?: unknown } | null)?.name);
  if (new Set(names).size !== names.length) return { ok: false, error: "Two proposals have the same name: send each skill once." };
  const out: ResolvedProposal[] = [];
  for (const [i, p] of list.entries()) {
    const r = typeof p === "object" && p !== null ? resolveOne(p as Record<string, unknown>, ctx) : "each proposal must be an object.";
    if (typeof r === "string") return { ok: false, error: `Proposal ${i + 1}${typeof names[i] === "string" ? ` (${names[i]})` : ""}: ${r}` };
    out.push(r);
  }
  const fresh = out.filter((p) => p.kind === "new").length;
  if (fresh > 0 && ctx.personal.size + fresh > MAX_SKILLS_PER_SCOPE) {
    return { ok: false, error: `The person already has ${ctx.personal.size} skills, and ${MAX_SKILLS_PER_SCOPE} is the most: improve one of them instead.` };
  }
  return { ok: true, proposals: out };
}
