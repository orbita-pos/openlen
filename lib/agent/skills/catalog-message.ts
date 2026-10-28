/**
 * THE SKILL CATALOG (spec local 2026-10-26-len-skills, §4.3): one durable `<system-reminder>` user
 * message at the start of the conversation with each skill's name and description, and, when that
 * changes, a NEW message further down that replaces it: the one above is never touched, so what follows
 * it stays in the cache. The wording is DeepSeek Harness's (`packages/skill/tool-skill/src/index.ts`,
 * `renderCatalogMessage` / `renderCatalogUpdate` / `renderCatalogEntries`; MIT,
 * LICENSES/deepseek-harness.MIT.txt), because it speaks to DeepSeek's model; the description cap is
 * theirs (500) and the budget of the whole list is Claude Code's (1% of the context window, 4
 * characters a token).
 *
 * The speaker's personal skills never go in the durable message (the conversation is shared among a
 * project's members): they ride the turn's context, like `~/.len/LEN.md` (`personalSkillsReminder`).
 *
 * Pure.
 */

// Cache effect: the catalog is saved in the transcript and replayed as sent; a change is a NEW message further down (by digest), never an edit of the one above, so the prefix before it stays cached. The personal reminder rides the turn's context, at the end.
import { createHash } from "node:crypto";

import type { ResolvedSkill } from "./registry";

export const SKILL_DESCRIPTION_MAX = 500;

export function catalogBudgetChars(contextWindowTokens: number): number {
  return Math.floor(contextWindowTokens * 4 * 0.01);
}

/** DeepSeek's `escapeText`: the description cannot open or close the framing tags. */
const escapeText = (v: string) => v.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** DeepSeek's `catalogDescription`. */
function capped(value: string, max: number): string {
  const normalized = value.replaceAll(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return max <= 3 ? "" : `${normalized.slice(0, max - 3)}...`;
}

const sorted = (skills: readonly ResolvedSkill[]) => [...skills].sort((a, b) => a.skill.name.localeCompare(b.skill.name));

/** The entry lines; over budget, every description shrinks by the same cap, never a name. */
function entries(skills: readonly ResolvedSkill[], budgetChars: number): string[] {
  const lines = (max: number) => sorted(skills).map((s) => `- \`${s.skill.name}\`${max > 3 ? `: ${escapeText(capped(s.skill.description, max))}` : ""}`);
  const size = (ls: string[]) => ls.reduce((n, l) => n + l.length + 1, 0);
  const full = lines(SKILL_DESCRIPTION_MAX);
  if (size(full) <= budgetChars) return full;
  let lo = 0;
  let hi = SKILL_DESCRIPTION_MAX;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (size(lines(mid)) <= budgetChars) lo = mid;
    else hi = mid - 1;
  }
  return lines(lo);
}

/** What identifies a catalog: its entries, not the prose around them (DeepSeek's `digestCatalogEntries`). */
export function catalogDigest(skills: readonly ResolvedSkill[]): string {
  const h = createHash("sha1");
  for (const s of sorted(skills)) h.update(`${s.skill.name}\0${s.skill.description}\n`);
  return h.digest("hex");
}

/** What the model already knows: the newest catalog digest among the rows the history resends. A
 *  catalog that left the window no longer counts, so it goes again (like `foldMemoryDigests`). */
export function foldSkillsDigest(rows: readonly { readonly transcript: { readonly skillsDigest?: string } | null }[]): string | null {
  let known: string | null = null;
  for (const row of rows) if (row.transcript?.skillsDigest) known = row.transcript.skillsDigest;
  return known;
}

const INSTRUCTIONS =
  "If the user names a skill, or the task clearly matches a skill's description, call the `skill` tool with the exact skill name before taking task actions. Load all applicable skills, then follow their full instructions. This catalog contains summaries only; do not infer or follow a skill's instructions until it has been loaded.";
const DIRECT = "A user may also invoke a skill directly; its <skill_content> block then appears in this conversation. Follow it, and do not call the `skill` tool again for that skill.";

/**
 * The durable catalog (OpenLen's and the project's skills). `known` = the digest of the last catalog
 * the model sees in the history, `null` if none. `null` back = nothing to send.
 */
export function skillCatalogMessage(skills: readonly ResolvedSkill[], known: string | null, budgetChars: number): { text: string; digest: string } | null {
  const digest = catalogDigest(skills);
  if (known === null && skills.length === 0) return null;
  if (known === digest) return null;
  const list = ["<available_skills>", ...entries(skills, budgetChars), "</available_skills>"];
  const lines =
    known === null
      ? ["<system-reminder>", "A skill is a reusable set of task-specific instructions. The following skills are available in this session:", "", ...list, "", INSTRUCTIONS, DIRECT, "</system-reminder>"]
      : [
          "<system-reminder>",
          "The available skill catalog changed. This complete catalog replaces every earlier available-skills list in this session:",
          "",
          ...list,
          "",
          ...(skills.length === 0
            ? [
                "No skills are currently available through the `skill` tool. Do not use names from earlier skill catalogs.",
                "A user may still invoke a skill directly; its <skill_content> block then appears in this conversation. Follow it, and do not call the `skill` tool for it.",
              ]
            : ["Use only names in this replacement catalog. If the user names a listed skill, or the task clearly matches its description, call the `skill` tool with the exact name before acting.", DIRECT]),
          "</system-reminder>",
        ];
  return { text: `${lines.join("\n")}\n`, digest };
}

/** The speaker's own skills, for the turn's context. `""` if there are none. */
export function personalSkillsReminder(skills: readonly ResolvedSkill[], budgetChars: number): string {
  if (skills.length === 0) return "";
  return `${[
    "<system-reminder>",
    "The person you are talking to also has skills of their own, available through the `skill` tool in the same way:",
    "",
    "<available_skills>",
    ...entries(skills, budgetChars),
    "</available_skills>",
    "</system-reminder>",
  ].join("\n")}\n`;
}
