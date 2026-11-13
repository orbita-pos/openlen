// THE GATES, WRITTEN BEFORE RUNNING (spec local 2026-11-13-conversar-todo-el-mes, §8.5). An arm passes if it
// holds all three against today's arm:
//
//   · quality, as a whole: its share of right answers is not more than 14 points under today's — the
//     smallest difference a measurement of this size can see;
//   · quality, question by question: no question that today gets right in its three runs is missed in two
//     or more of the arm's three. The fine gate: a question that always breaks shows even when the whole
//     does not move;
//   · cost and mechanism: the return and the two messages after it cost at least 40 % less, re-reads
//     included, and the drop shows in the tokens of the first call.
//
// What could not be judged — the provider failed, the arm's mechanism did not happen — counts for neither
// side and is reported apart.
import type { QuestionKind, RunResult } from "./types";

export const QUALITY_MARGIN = 0.14;
export const COST_SAVING = 0.4;
/** «The drop shows in the first call»: it is at least this much smaller than today's. */
export const FIRST_CALL_DROP = 0.1;
/** Runs a question needs under an arm before the question-by-question gate speaks for it. */
export const RUNS_TO_JUDGE = 3;
const EPSILON = 1e-9;

export interface GateInput {
  readonly today: readonly RunResult[];
  readonly arm: readonly RunResult[];
  /** The size class of a case, in thousands of tokens. */
  readonly sizeOf: (caseId: string) => number;
}

export interface BrokenQuestion {
  readonly caseId: string;
  /** 0-based. */
  readonly question: number;
  readonly kind: QuestionKind;
  readonly todayRight: number;
  readonly armRight: number;
}

interface Tally {
  readonly runs: number;
  readonly questions: number;
}

export interface GateResult {
  readonly pass: boolean;
  readonly quality: { readonly pass: boolean; readonly today: number; readonly arm: number };
  readonly perQuestion: {
    readonly pass: boolean;
    readonly broken: readonly BrokenQuestion[];
    /** Questions with fewer than three judged answers on either side: the gate says nothing about them. */
    readonly unjudged: readonly { readonly caseId: string; readonly question: number; readonly todayJudged: number; readonly armJudged: number }[];
  };
  readonly cost: { readonly pass: boolean; readonly saving: number; readonly firstCallDrop: number };
  /** What entered the count, and what was left out of it. */
  readonly counted: { readonly today: Tally; readonly arm: Tally };
  readonly left: { readonly today: Tally; readonly arm: Tally };
  /** The smallest size class from which no question breaks, at that size or any larger: where the summary's
   *  threshold can sit. `null`: it breaks one at every size. */
  readonly smallestCleanSize: number | null;
}

const valid = (runs: readonly RunResult[]) => runs.filter((run) => !run.infra);
const judged = (runs: readonly RunResult[]) => valid(runs).flatMap((run) => run.questions.filter((q) => !q.infra));
const mean = (values: readonly number[]): number => (values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length);

function tally(runs: readonly RunResult[]): { counted: Tally; left: Tally } {
  const ok = valid(runs);
  return {
    counted: { runs: ok.length, questions: judged(runs).length },
    left: { runs: runs.length - ok.length, questions: ok.reduce((n, run) => n + run.questions.filter((q) => q.infra).length, 0) },
  };
}

const share = (runs: readonly RunResult[]): number => {
  const answers = judged(runs);
  return answers.length === 0 ? 0 : answers.filter((q) => q.pass).length / answers.length;
};

/** Per case and question: how many answers were judged and how many were right. */
function byQuestion(runs: readonly RunResult[]): Map<string, { caseId: string; question: number; kind: QuestionKind; judged: number; right: number }> {
  const out = new Map<string, { caseId: string; question: number; kind: QuestionKind; judged: number; right: number }>();
  for (const run of valid(runs)) {
    run.questions.forEach((q, question) => {
      const key = `${run.caseId}#${question}`;
      const row = out.get(key) ?? { caseId: run.caseId, question, kind: q.kind, judged: 0, right: 0 };
      if (!q.infra) {
        row.judged += 1;
        if (q.pass) row.right += 1;
      }
      out.set(key, row);
    });
  }
  return out;
}

export function gates(input: GateInput): GateResult {
  const today = tally(input.today);
  const arm = tally(input.arm);

  const quality = { today: share(input.today), arm: share(input.arm) };
  const qualityPass = quality.arm >= quality.today - QUALITY_MARGIN - EPSILON;

  const todayQ = byQuestion(input.today);
  const armQ = byQuestion(input.arm);
  const broken: BrokenQuestion[] = [];
  const unjudged: { caseId: string; question: number; todayJudged: number; armJudged: number }[] = [];
  for (const [key, t] of todayQ) {
    const a = armQ.get(key);
    const armJudged = a?.judged ?? 0;
    if (t.judged < RUNS_TO_JUDGE || armJudged < RUNS_TO_JUDGE) {
      unjudged.push({ caseId: t.caseId, question: t.question, todayJudged: t.judged, armJudged });
      continue;
    }
    if (t.right === t.judged && armJudged - a!.right >= 2) broken.push({ caseId: t.caseId, question: t.question, kind: t.kind, todayRight: t.right, armRight: a!.right });
  }

  // Case by case, then the mean of the savings: a cheap small case must not hide a dear big one.
  const cases = [...new Set(valid(input.today).map((run) => run.caseId))].filter((id) => valid(input.arm).some((run) => run.caseId === id));
  const of = (runs: readonly RunResult[], id: string, pick: (run: RunResult) => number) => mean(valid(runs).filter((run) => run.caseId === id).map(pick));
  const drop = (pick: (run: RunResult) => number) =>
    mean(
      cases.flatMap((id) => {
        const before = of(input.today, id, pick);
        return before > 0 ? [1 - of(input.arm, id, pick) / before] : [];
      }),
    );
  const saving = drop((run) => run.costUsd);
  const firstCallDrop = drop((run) => run.firstCallTokens);
  const costPass = cases.length > 0 && saving >= COST_SAVING - EPSILON && firstCallDrop >= FIRST_CALL_DROP - EPSILON;

  const sizes = [...new Set(cases.map(input.sizeOf))].sort((a, b) => a - b);
  const dirty = new Set(broken.map((b) => input.sizeOf(b.caseId)));
  const smallestCleanSize = sizes.find((size) => sizes.filter((s) => s >= size).every((s) => !dirty.has(s))) ?? null;

  const perQuestionPass = broken.length === 0;
  return {
    pass: qualityPass && perQuestionPass && costPass,
    quality: { pass: qualityPass, ...quality },
    perQuestion: { pass: perQuestionPass, broken, unjudged },
    cost: { pass: costPass, saving, firstCallDrop },
    counted: { today: today.counted, arm: arm.counted },
    left: { today: today.left, arm: arm.left },
    smallestCleanSize,
  };
}

const pct = (x: number): string => `${(x * 100).toFixed(1)} %`;

/** The gates as lines to read: every number that decided, and what was left out. */
export function gateLines(label: string, result: GateResult): string[] {
  const lines = [
    `Brazo ${label}: ${result.pass ? "PASA" : "NO PASA"}`,
    `  calidad en conjunto  ${result.quality.pass ? "pasa" : "NO pasa"} · acierta ${pct(result.quality.arm)} frente a ${pct(result.quality.today)} de «hoy» (margen ${pct(QUALITY_MARGIN)})`,
    `  pregunta a pregunta  ${result.perQuestion.pass ? "pasa" : "NO pasa"} · ${result.perQuestion.broken.length} rota(s)`,
    ...result.perQuestion.broken.map((b) => `      ${b.caseId} · pregunta ${b.question + 1} (${b.kind}): «hoy» ${b.todayRight} de 3, el brazo ${b.armRight} de 3`),
    `  coste y mecanismo    ${result.cost.pass ? "pasa" : "NO pasa"} · ${pct(result.cost.saving)} menos (hacen falta ${pct(COST_SAVING)}) · la primera llamada baja ${pct(result.cost.firstCallDrop)}`,
    `  contado: ${result.counted.arm.runs} corridas y ${result.counted.arm.questions} respuestas del brazo, ${result.counted.today.runs} y ${result.counted.today.questions} de «hoy»`,
  ];
  const out = result.left.arm.runs + result.left.arm.questions + result.left.today.runs + result.left.today.questions;
  if (out > 0) lines.push(`  fuera de la cuenta por fallos que no son de la respuesta: ${result.left.arm.runs} corridas y ${result.left.arm.questions} respuestas del brazo, ${result.left.today.runs} y ${result.left.today.questions} de «hoy»`);
  if (result.perQuestion.unjudged.length > 0) lines.push(`  ${result.perQuestion.unjudged.length} pregunta(s) con menos de ${RUNS_TO_JUDGE} respuestas juzgadas: la puerta fina no dice nada de ellas`);
  return lines;
}
