// THE ARMS (spec local 2026-11-13-conversar-todo-el-mes, §8.3) and how a run proves it measured the one it
// says. Every arm goes through the real route of the bench's local server; what differs is how that server
// was started. The runner cannot read another process's environment, so after each run it looks at what the
// route LEFT in the rows — the trim's mark, the promoted summary — and a run where the arm's mechanism did
// not happen is thrown out and said, never counted.
import type { Arm } from "./types";

export type ServerConfig = "build" | "today" | "new";

/**
 * What the bench's server is started with, on top of Len-Bench's own environment (lib/len-bench/entorno.ts).
 * `OPENLEN_SANDBOX=0` in all three: a box of the real terminal costs money by the second.
 *   · build — the cases are built on the new code; at the end of a turn the idle summary's job is WRITTEN TO
 *     A FILE instead of armed (lib/agent/idle-summary-capture.ts), for every conversation however short.
 *   · today — neither piece: the whole conversation is sent again, as before.
 *   · new — both pieces. No timer is ever armed (the minimum is out of reach): the bench writes the summary
 *     itself, with the same function the timer calls, and the route only has to promote it.
 */
export const SERVER_ENV: Readonly<Record<ServerConfig, Readonly<Record<string, string>>>> = {
  build: { OPENLEN_SANDBOX: "0", OPENLEN_COLD_RETURN: "1", OPENLEN_IDLE_SUMMARY: "1", OPENLEN_IDLE_SUMMARY_MIN_TOKENS: "1", OPENLEN_IDLE_SUMMARY_CAPTURE_DIR: "<the bench's captures folder>" },
  today: { OPENLEN_SANDBOX: "0", OPENLEN_COLD_RETURN: "0", OPENLEN_IDLE_SUMMARY: "0" },
  new: { OPENLEN_SANDBOX: "0", OPENLEN_COLD_RETURN: "1", OPENLEN_IDLE_SUMMARY: "1", OPENLEN_IDLE_SUMMARY_MIN_TOKENS: "999999999" },
};

export interface ArmSpec {
  /** As the spec names it. */
  readonly label: string;
  readonly server: Exclude<ServerConfig, "build">;
  /** The run starts from a summary written while idle. */
  readonly summary: boolean;
}

export const ARM_SPECS: Readonly<Record<Arm, ArmSpec>> = {
  today: { label: "hoy", server: "today", summary: false },
  trim: { label: "A", server: "new", summary: false },
  trim_summary: { label: "A+B", server: "new", summary: true },
};

/** What the route left behind in a run. */
export interface Mechanism {
  /** The row of the first question carries the trim's mark (`transcript.coldTrim`). */
  readonly firstQuestionTrimmed: boolean;
  /** The last turn of the built conversation carries a mark written while idle: its summary was promoted. */
  readonly summaryPromoted: boolean;
  /** Rows of `projectSandboxes` for the project. */
  readonly sandboxRows: number;
}

/** Why this run did NOT measure its arm, or `null` when it did. */
export function mechanismProblem(arm: Arm, seen: Mechanism): string | null {
  if (seen.sandboxRows > 0) return "a box of the real terminal was opened for this project: the bench's server must be started with OPENLEN_SANDBOX=0";
  if (arm === "today") {
    if (seen.firstQuestionTrimmed) return "the first question was trimmed: the server for «hoy» must be started with OPENLEN_COLD_RETURN=0";
    if (seen.summaryPromoted) return "a summary was promoted: the server for «hoy» must be started with OPENLEN_IDLE_SUMMARY=0";
    return null;
  }
  if (arm === "trim") {
    if (seen.summaryPromoted) return "the run started from a summary, and this arm has none";
    if (!seen.firstQuestionTrimmed) return "the first question was not trimmed: the server must be the «new» one (OPENLEN_COLD_RETURN on) and the conversation must look cold";
    return null;
  }
  if (!seen.summaryPromoted) return "the summary was not promoted: the server must be the «new» one (OPENLEN_IDLE_SUMMARY on), the summary must be waiting on the last turn and the conversation must look cold";
  if (seen.firstQuestionTrimmed) return "the first question was trimmed although it started from a summary";
  return null;
}
