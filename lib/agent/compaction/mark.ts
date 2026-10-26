// A11 (spec local 2026-10-25-a11-continuity): the compaction mark, Claude Code's
// `compact_boundary` for Len. When the loop summarizes, what the model saw from
// then on is saved with the turn's row, so the next turn (and a restart) rebuild
// it byte for byte instead of summarizing again or losing the summary. Pure.
import type { Message } from "@/lib/ai-gateway";

export type CompactionTrigger = "pressure" | "overflow" | "manual";

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
}

const TRIGGERS: ReadonlySet<string> = new Set<CompactionTrigger>(["pressure", "overflow", "manual"]);

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
    isCount(m.postTokens)
  );
}
