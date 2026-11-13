// THE RETURN BENCH (spec local 2026-11-13-conversar-todo-el-mes, §8): does Len — or the person's own
// assistant — answer as well when someone comes back to a long conversation hours later, now that the
// history is trimmed (piece A) or starts from a summary written while idle (piece B)? And how much less does
// that return cost?
//
// A CASE is a conversation built once, with real turns, and three questions asked on coming back. A RUN puts
// the case back as it was built, moves it ten hours into the past, and asks the three questions in order:
// the first is the cold return, the other two are the messages that follow it (spec §8.5: «la vuelta más los
// dos mensajes siguientes»). An ARM is which code answers: today's (everything is sent again), the trim, or
// the trim plus the summary.
import type { DatosDelCaso, WebDelCaso } from "@/lib/len-bench/tipos";

/** Spec §8.3: «hoy», A and A+B. */
export type Arm = "today" | "trim" | "trim_summary";
export const ARMS: readonly Arm[] = ["today", "trim", "trim_summary"];

export type CaseFamily = "chat" | "build";

/** What a question leans on (spec §8.2): something the person said at the start; the work where it was
 *  left; or a result of long ago that the trim clears, so it has to be read or searched again. */
export type QuestionKind = "early" | "continue" | "old_result";
export const QUESTION_KINDS: readonly QuestionKind[] = ["early", "continue", "old_result"];

/** One thing a good answer has — or must not have. All of a question's checks must hold. */
export type Check =
  | { readonly on: "answer"; readonly has: RegExp; readonly why: string }
  | { readonly on: "answer"; readonly lacks: RegExp; readonly why: string }
  /** A file of the project after the turn; `/index.html` is the page itself. */
  | { readonly on: "file"; readonly path: string; readonly has: RegExp; readonly why: string }
  | { readonly on: "file"; readonly path: string; readonly lacks: RegExp; readonly why: string }
  /** Any file of the project (an app's screens have names Len chooses). */
  | { readonly on: "files"; readonly has: RegExp; readonly why: string }
  | { readonly on: "files"; readonly lacks: RegExp; readonly why: string };

export interface ReturnQuestion {
  readonly kind: QuestionKind;
  /** What the person writes, as they would. */
  readonly prompt: string;
  readonly checks: readonly Check[];
}

export interface ReturnCase {
  readonly id: string;
  readonly family: CaseFamily;
  /** How long the built conversation is meant to be, in thousands of tokens, without the fixed start of a
   *  request. What it really measures is read after building it. */
  readonly targetKTokens: 40 | 100 | 220;
  readonly title: string;
  readonly brief: string;
  /** What the project is before the first message. */
  readonly start: DatosDelCaso;
  /** A chat case: the conversation is with the person's own assistant, of this name. */
  readonly assistant?: { readonly name: string };
  /** The fixed web `web_search` and `web_fetch` read in the bench (no request leaves the machine). */
  readonly web?: WebDelCaso;
  /** The person's messages that build the conversation, in order. */
  readonly build: readonly string[];
  readonly questions: readonly [ReturnQuestion, ReturnQuestion, ReturnQuestion];
}

/** What a turn left, for grading. */
export interface TurnOutcome {
  /** What was written to the person. */
  readonly answer: string;
  /** The project's files after the turn; `/index.html` is the page. */
  readonly files: Readonly<Record<string, string>>;
}

export interface QuestionResult {
  readonly kind: QuestionKind;
  readonly pass: boolean;
  /** The `why` of each check that did not hold. */
  readonly failed: readonly string[];
  /** The turn could not be judged for a reason that is not the answer's: the provider failed, the route
   *  refused. It counts for neither side. */
  readonly infra?: string;
}

/** One run of one case under one arm: the unit everything is counted in. */
export interface RunResult {
  readonly caseId: string;
  readonly arm: Arm;
  /** 1-based. */
  readonly run: number;
  readonly questions: readonly QuestionResult[];
  /** The whole run is out of the count: the arm's mechanism did not happen, the case could not be put back… */
  readonly infra?: string;
  /** What the run would cost in production (see ./cost.ts), USD at list price. */
  readonly costUsd: number;
  /** Input tokens of the cold return's first call: where the saving has to show. */
  readonly firstCallTokens: number;
  /** What the run really spent on the provider, for the budget. */
  readonly spentUsd: number;
  readonly seconds: number;
}
