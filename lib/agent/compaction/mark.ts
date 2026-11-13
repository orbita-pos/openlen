// A11 (spec local 2026-10-25-a11-continuity): the compaction mark, Claude Code's
// `compact_boundary` for Len. When the loop summarizes, what the model saw from
// then on is saved with the turn's row, so the next turn (and a restart) rebuild
// it byte for byte instead of summarizing again or losing the summary. Pure.
import type { Message } from "@/lib/ai-gateway";

/** `idle` (spec local 2026-11-13-conversar-todo-el-mes, piece B): the summary was written while the conversation
 *  sat idle, with the provider's cache still warm, and became the mark when a turn came back cold. */
export type CompactionTrigger = "pressure" | "overflow" | "manual" | "idle";

export interface CompactionMark {
  /** What the model saw after the summary, from the first summarizable message
   *  on (the summary first): it replaces everything before it in the history. */
  readonly messages: Message[];
  /** How many of the turn's own transcript messages the summary already covers
   *  or carries in `messages`: the history goes on from that index. */
  readonly fromTranscript: number;
  readonly trigger: CompactionTrigger;
  /** Tokens before and after, for the chat's «summarized» line and layer 0. */
  readonly preTokens: number;
  readonly postTokens: number;
  /** The skills the model sees right after the summary (the ones that came back with it and the
   *  ones the kept messages show), as state: `foldLoadedSkills`. Absent on a mark from before they
   *  came back, which forgets them all. */
  readonly skills?: string[];
}

const TRIGGERS: ReadonlySet<string> = new Set<CompactionTrigger>(["pressure", "overflow", "manual", "idle"]);

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** A row's `compaction` column, as jsonb gives it back. */
export function isCompactionMark(v: unknown): v is CompactionMark {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  return (
    Array.isArray(m.messages) &&
    m.messages.length > 0 &&
    m.messages.every((x) => !!x && typeof x === "object" && typeof (x as { content?: unknown }).content === "string") &&
    isCount(m.fromTranscript) &&
    typeof m.trigger === "string" &&
    TRIGGERS.has(m.trigger) &&
    isCount(m.preTokens) &&
    isCount(m.postTokens) &&
    (m.skills === undefined || (Array.isArray(m.skills) && m.skills.every((s) => typeof s === "string")))
  );
}

/**
 * A mark written while the conversation sat idle (lib/agent/idle-summary.ts). It was written AFTER its row's
 * turn ended, so it covers that whole turn: the memory message and the skills catalog the turn opened with,
 * and the skills it loaded, were summarized away with the rest. What the row says it showed (`memoriaHuellas`,
 * `skillsDigest`, `skillsLoaded`) is therefore no longer in view, and whoever folds that state from the rows
 * must not count it — or Len would stop receiving /LEN.md while the server believes he has it.
 */
export function isIdleMark(v: unknown): boolean {
  return isCompactionMark(v) && v.trigger === "idle";
}
