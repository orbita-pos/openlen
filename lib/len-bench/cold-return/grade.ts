// The grade of one answer: every check of the question holds, or the reasons of those that did not. No
// model judges here — the cases are built so that a right answer has something that can be looked for
// (./cases). Where that is not enough, a judge of another family is a separate, paid step (spec §8.3).
import type { Check, QuestionResult, ReturnQuestion, TurnOutcome } from "./types";

/** A pattern as written in a case, used any number of times: without the flags that make `test` remember. */
const fresh = (pattern: RegExp): RegExp => new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""));

function holds(check: Check, outcome: TurnOutcome): boolean {
  const text = check.on === "answer" ? outcome.answer : check.on === "file" ? (outcome.files[check.path] ?? "") : Object.values(outcome.files).join("\n");
  return "has" in check ? fresh(check.has).test(text) : !fresh(check.lacks).test(text);
}

export function grade(question: ReturnQuestion, outcome: TurnOutcome): QuestionResult {
  const failed = question.checks.filter((check) => !holds(check, outcome)).map((check) => check.why);
  return { kind: question.kind, pass: failed.length === 0, failed };
}
