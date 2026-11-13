// THE COLD RETURN (spec local 2026-11-13-conversar-todo-el-mes, piece A). A turn that starts
// long after the conversation's last model call finds the provider's prompt cache gone, and the
// whole conversation is paid again at the full input price (production, 12/11: one message after a
// day's pause re-sent 215.399 tokens). Such a turn sends the history TRIMMED, with no model call:
// what was thought in older turns goes, and so do the tool results older than the most recent ones
// (`coldTrim` in ./transcripcion.ts). The numbers are Claude Code's (binary 2.1.321, its tool-result
// clearing after an idle period): `minIdleSeconds: 3900`, `keepToolUses: 12`,
// `clearAtLeastTokens: 20000`.
//
// Effect on the cache: none is lost — the trim only happens when the cache has already expired. The
// turn that trims leaves this mark on its row, and every later turn applies it to the same rows, so
// the prefix that is cached again after the trim keeps matching.
//
// Pure, and it imports nothing from ./transcripcion.ts (that file imports this one).

/** The environment these read: the process's, or a plain object in a test. */
type Env = Readonly<Record<string, string | undefined>>;

export const COLD_AFTER_MIN_DEFAULT = 65;

/** Characters per token, for the floor of the trim. The compaction's own figure (`CHARS_PER_TOKEN`,
 *  ./compaction/estimate.ts), repeated here because that module reaches ./transcripcion.ts through
 *  ./context.ts; a test keeps the two equal. */
export const COLD_CHARS_PER_TOKEN = 3.5;

/** What a cold turn did to the history before it, saved with its row (`TranscripcionGuardada.coldTrim`). */
export interface ColdTrimMark {
  readonly v: 1;
  /** Tool results kept whole, counted from the most recent. */
  readonly keepResults: number;
  /** The results are only emptied when that frees at least this many tokens. */
  readonly clearAtLeastTokens: number;
}

export const COLD_TRIM_MARK: ColdTrimMark = Object.freeze({ v: 1, keepResults: 12, clearAtLeastTokens: 20_000 });

/** What a cold return may empty: only the results Len can ask for again — as Claude Code, which clears
 *  Read, Bash, Grep, Glob, WebSearch, WebFetch, Edit and Write and nothing else. What the owner answered
 *  (`ask_user_question`), what a subagent handed back, a loaded skill, a publish… stay whole: nobody can
 *  run those again to get them back. This list is part of what `v: 1` of the mark means: changing it
 *  needs a new version, or every conversation already marked is paid in full once more. */
export const COLD_CLEARABLE_TOOLS: ReadonlySet<string> = new Set(["Read", "Write", "Edit", "Glob", "Grep", "bash", "web_search", "web_fetch", "view_page", "use_page"]);

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** A row's `coldTrim`, as jsonb gives it back. Anything else is ignored: the history then comes back whole. */
export function isColdTrimMark(v: unknown): v is ColdTrimMark {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  return m.v === 1 && isCount(m.keepResults) && isCount(m.clearAtLeastTokens);
}

/** How long after the last model call a turn is cold. `OPENLEN_COLD_AFTER_MIN` (whole minutes, above
 *  zero) moves it; an unrecognized value is ignored rather than breaking the turn. */
export function coldAfterMs(env: Env = process.env): number {
  const raw = env.OPENLEN_COLD_AFTER_MIN?.trim() ?? "";
  const minutes = /^[1-9]\d*$/.test(raw) ? Number(raw) : COLD_AFTER_MIN_DEFAULT;
  return minutes * 60_000;
}

/** Opt-out: only the literal `0` stops NEW trims. Marks already saved are applied regardless — they
 *  are data, and ignoring them would change a history the provider has cached. */
export function coldReturnEnabled(env: Env = process.env): boolean {
  return env.OPENLEN_COLD_RETURN !== "0";
}

/** Whether a turn starting `sinceLastMs` after the conversation's last model call is a cold return.
 *  An unknown elapsed time (no earlier turn) or a negative one (a clock that went back) is not. */
export function isColdReturn(sinceLastMs: number | null, env: Env = process.env): boolean {
  return coldReturnEnabled(env) && sinceLastMs !== null && sinceLastMs > coldAfterMs(env);
}
