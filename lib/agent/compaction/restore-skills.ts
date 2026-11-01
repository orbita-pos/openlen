// After a summary, the skills the conversation had loaded come back, as Claude Code does after
// compacting (the most recent first, each cut to 5,000 tokens and 25,000 in all; what does not fit
// is no longer loaded, and one the kept messages still show is not repeated). DeepSeek's harness only sends the catalog again, so the behavior is Claude Code's; each
// skill comes back as the `<skill_content>` block the model saw when it was loaded, and the preface is
// ours. Pure.

// Cache effect: only right after a summary, which already rebuilds the prefix; the message goes into the compaction mark and comes back from it byte for byte on later turns.
import type { Message } from "@/lib/ai-gateway";
import type { ResolvedSkill } from "@/lib/agent/skills/registry";
import { renderSkillContent } from "@/lib/agent/skills/tool";
import { CLAVE_TOOL_RESULT } from "@/lib/agent/ficheros/resultado";

import { CHARS_PER_TOKEN } from "./estimate";

export const POST_COMPACT_MAX_TOKENS_PER_SKILL = 5_000;
export const POST_COMPACT_SKILLS_TOKEN_BUDGET = 25_000;

const PREFACE = [
  "These skills were loaded earlier in this conversation, before it was summarized, not in the current turn. They come back here only so that you keep their guidelines in view.",
  "",
  "IMPORTANT: Do NOT run these skills again, and do NOT repeat their one-time actions (scheduling a task, creating files and the like). Any request or input that a skill below carries was captured when it was first loaded: the user did not send it now and it asks for nothing new, so do not act on it. Keep applying only the ongoing guidelines of these skills, where they still apply.",
].join("\n");

const cutNote = (baseDir: string): string =>
  `\n\n[... the rest of this skill was cut when the conversation was summarized; Read ${baseDir}/SKILL.md for the whole text]`;

const tokens = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN);

/** The skill with its instructions cut to the per-skill limit, with the note at the end. */
function capped(s: ResolvedSkill): ResolvedSkill {
  if (tokens(s.skill.body) <= POST_COMPACT_MAX_TOKENS_PER_SKILL) return s;
  const note = cutNote(s.baseDir);
  const body = s.skill.body.slice(0, Math.floor(POST_COMPACT_MAX_TOKENS_PER_SKILL * CHARS_PER_TOKEN) - note.length) + note;
  return { ...s, skill: { ...s.skill, body } };
}

/** Whether a message the summary kept still shows this block: a `skill` result or a /name message. */
function shows(m: Message, block: string): boolean {
  return m.content.includes(block) || !!m.functionResponses?.some((r) => {
    const text = r.response[CLAVE_TOOL_RESULT];
    return typeof text === "string" && text.includes(block);
  });
}

/**
 * `loaded` in the order they were loaded (the oldest first); `kept`, the messages after the summary.
 * Back: the message that goes after it (or `null`) and the skills the model sees from then on, in
 * the same order.
 */
export function restoredSkills(loaded: readonly ResolvedSkill[], kept: readonly Message[]): { message: Message | null; loaded: string[] } {
  const stays = new Set<string>();
  const blocks: string[] = [];
  let spent = 0;
  for (const s of [...loaded].reverse()) {
    if (kept.some((m) => shows(m, renderSkillContent(s)))) {
      stays.add(s.skill.name);
      continue;
    }
    const block = renderSkillContent(capped(s));
    const cost = tokens(block);
    if (spent + cost > POST_COMPACT_SKILLS_TOKEN_BUDGET) continue;
    spent += cost;
    blocks.push(block);
    stays.add(s.skill.name);
  }
  return {
    message: blocks.length > 0 ? { role: "user", content: ["<system-reminder>", PREFACE, "", blocks.join("\n\n"), "</system-reminder>"].join("\n") } : null,
    loaded: loaded.map((s) => s.skill.name).filter((n) => stays.has(n)),
  };
}
