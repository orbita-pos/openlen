/**
 * THE `skill` TOOL (spec local 2026-10-26-len-skills, §4.4): DeepSeek Harness's `skill({ name })`
 * (`packages/skill/tool-skill/src/index.ts`, MIT, LICENSES/deepseek-harness.MIT.txt): its name, its
 * description, its three errors and its `<skill_content>` answer (`renderSkillContent`, in
 * `packages/skill/skill/src/index.ts`). A skill already loaded in this conversation is compared by its
 * content, as Claude Code does: the same text is not sent again (Claude Code's line says so);
 * a changed one goes again, behind Claude Code's re-invocation line.
 *
 * Read-only: it counts against no write budget (`READ_ME`-like, `READ_ONLY_TOOLS` in loop.ts).
 */
import { createHash } from "node:crypto";

import type { ResolvedSkill } from "./registry";
import { SKILL_NAME } from "./skill-file";
import { isCompactionMark, type CompactionMark } from "@/lib/agent/compaction/mark";

import type { AgentDeps, AgentSession, ToolOutcome } from "@/lib/agent/tools";
import { subagentsEnabled } from "@/lib/agent/subagents/enabled";
import { BUILT_IN_AGENT_TYPES } from "@/lib/agent/subagents/agent-paths";

export const SKILL_TOOL = "skill";
/** The «Crear» card's skill (spec local 2026-11-04-herramientas-hechas-por-len, §4.10). */
export const TOOL_SUGGESTIONS = "tool-suggestions";

export const DECLARACION_SKILL = {
  name: SKILL_TOOL,
  description: "Load the full instructions for a skill. Call it before acting on a task that names or clearly matches a skill in the session skill catalog.",
  parameters: {
    type: "OBJECT",
    properties: {
      name: { type: "STRING", description: "The exact skill name from the available skills list." },
      args: { type: "STRING", description: "For a skill that runs in a subagent: the task to hand it, complete and self-contained. Leave it out for any other skill." },
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

/** Claude Code's answer when the skill is already in the conversation, byte for byte. */
export const alreadyLoaded = (name: string) => `Skill /${name} is already loaded above; instructions unchanged.`;
/** Claude Code's line in front of a skill loaded again whose content changed: the new text follows. */
export const reinvocationLine = (name: string) =>
  `(Re-invocation of /${name} — the skill instructions were previously loaded; the arguments or dynamic output below are new.)`;

/** What tells two copies of a skill apart: a digest of the exact text the model was given. */
export const skillDigest = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 16);

const isDigestRecord = (v: unknown): v is Readonly<Record<string, string>> =>
  !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((d) => typeof d === "string");

/**
 * The copy of each skill the model has, by name (Claude Code compares the content, not the name): what each row
 * says it gave (`skillDigests`), from the last summary on, the latest winning. A skill with no recorded copy — a
 * row from before copies were recorded, one that came back with a summary — is taken as unchanged.
 */
export function foldSkillDigests(
  rows: readonly { readonly compaction?: unknown; readonly transcript: { readonly skillDigests?: unknown } | null }[],
): Map<string, string> {
  const digests = new Map<string, string>();
  const lastMark = rows.findLastIndex((r) => isCompactionMark(r.compaction));
  for (const [i, r] of rows.entries()) {
    if (i < lastMark) continue;
    // A mark that names no skills (written idle, or from before they came back) forgets its row's, as `foldLoadedSkills`.
    if (i === lastMark && !(r.compaction as CompactionMark).skills) continue;
    const given = r.transcript?.skillDigests;
    if (isDigestRecord(given)) for (const [name, digest] of Object.entries(given)) digests.set(name, digest);
  }
  return digests;
}

/** For the turn's row: the copies it gave that the history didn't already have (a new skill, a changed one). */
export function skillDigestsToSave(now: ReadonlyMap<string, string> | undefined, known: ReadonlyMap<string, string>): { skillDigests?: Record<string, string> } {
  const given = [...(now ?? [])].filter(([name, digest]) => known.get(name) !== digest);
  return given.length > 0 ? { skillDigests: Object.fromEntries(given) } : {};
}

/**
 * Which skills the conversation already shows, as STATE (as Claude Code keeps them, and DeepSeek's
 * messages sourced `skill-invocation`): each row records what its turn loaded (`skillsLoaded`). A
 * summary starts over from the skills its mark says the model still sees (the ones that came back
 * with it, as Claude Code attaches its invoked skills again on compaction), plus what that turn loaded
 * afterwards; a mark from before they came back forgets everything up to its row. Never read from
 * text, which anyone could type.
 */
export function foldLoadedSkills(
  rows: readonly { readonly compaction?: unknown; readonly transcript: { readonly skillsLoaded?: readonly string[] } | null }[],
): Set<string> {
  const loaded = new Set<string>();
  const lastMark = rows.findLastIndex((r) => isCompactionMark(r.compaction));
  for (const [i, r] of rows.entries()) {
    if (i < lastMark) continue;
    if (i === lastMark) {
      const kept = (r.compaction as CompactionMark).skills;
      if (!kept) continue;
      for (const name of kept) loaded.add(name);
    }
    for (const name of r.transcript?.skillsLoaded ?? []) loaded.add(name);
  }
  return loaded;
}

/** Ours: acknowledgements for a skill executed in its own child. */
export const forkedSkillLine = (name: string, id: string) => `Skill "${name}" started in subagent ${id}; its result arrives as a notice.`;
export const ALREADY_RUNNING_IT = "You are the subagent already running this skill: follow its instructions above instead of starting it again.";

export async function toolSkill(session: AgentSession, args: Record<string, unknown>, deps?: Pick<AgentDeps, "subagents" | "suggestionCatalog">): Promise<ToolOutcome> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  if (!SKILL_NAME.test(name)) return { response: { ok: false, error: `invalid skill name "${String(args.name ?? "")}"` } };
  const found = session.skills?.get(name);
  if (!found) return { response: { ok: false, error: `skill "${name}" is unknown or no longer available` } };
  if (!found.skill.modelInvocable) return { response: { ok: false, error: `skill "${name}" is not available for model invocation` } };
  if (session.runningSkill === name) return { response: { ok: false, error: ALREADY_RUNNING_IT } };
  if (found.skill.fork && deps?.subagents && subagentsEnabled(process.env)) {
    await deps.subagents.refreshTypes?.();
    const preset = found.skill.fork.agent;
    const names = deps.subagents.typeNames?.() ?? [...BUILT_IN_AGENT_TYPES];
    if (!names.includes(preset)) return { response: { ok: false, error: "invalid_arguments", message: `agent_preset must be one of: ${names.join(", ")}` } };
    const task = typeof args.args === "string" ? args.args.trim() : "";
    const prompt = [task, renderSkillContent(found)].filter(Boolean).join("\n\n");
    const result = await deps.subagents.launch({ description: name, prompt, preset, fromSkill: name });
    if (!result.ok) return { response: { ok: false, error: result.code, message: result.message } };
    return { response: { ok: true, tool_result: forkedSkillLine(name, result.id) }, action: { tool: SKILL_TOOL, ok: true, summary: name }, subagent: { id: result.id, preset } };
  }
  // This turn's loads, «already loaded» included (DeepSeek's `turnLoads`): `propose_action` needs its skill here.
  (session.turnSkillLoads ??= new Set()).add(name);
  const loaded = (session.loadedSkills ??= new Set());
  // `tool-suggestions` carries what already exists, as DeepSeek's `personalized-pages` appends its official plugins.
  const catalog = name === TOOL_SUGGESTIONS && deps?.suggestionCatalog ? await deps.suggestionCatalog().catch(() => null) : null;
  const content = catalog ? `${renderSkillContent(found)}

${catalog}` : renderSkillContent(found);
  // As in Claude Code: a skill already loaded is compared by CONTENT. The same bytes, its line; different ones
  // (the skill was improved, or its dynamic part changed), the new text behind its re-invocation line.
  const digest = skillDigest(content);
  const copies = (session.loadedSkillDigests ??= new Map());
  if (loaded.has(name)) {
    const prior = copies.get(name);
    if (prior === undefined || prior === digest) return { response: { ok: true, tool_result: alreadyLoaded(name) } };
    copies.set(name, digest);
    return { response: { ok: true, tool_result: `${reinvocationLine(name)}\n\n${content}` }, action: { tool: SKILL_TOOL, ok: true, summary: name } };
  }
  loaded.add(name);
  copies.set(name, digest);
  return { response: { ok: true, tool_result: content }, action: { tool: SKILL_TOOL, ok: true, summary: name } };
}
