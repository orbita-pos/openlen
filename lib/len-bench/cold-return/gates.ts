// THE GATES, WRITTEN BEFORE RUNNING (spec local 2026-11-13-conversar-todo-el-mes, §8.5). An arm passes if it
// holds all three against today's arm:
//
//   · quality, as a whole: its share of right answers is not more than 14 points under today's — the
//     smallest difference a measurement of this size can see;
//   · quality, question by question: no question that today gets right in its three runs is missed in two
//     or more of the arm's three. The fine gate: a question that always breaks shows even when the whole
//     does not move;
//   · cost and mechanism: the return and the two messages after it cost at least 40 % less, re-reads
//     included, and the drop shows in the tokens of the first call. «40 % less» is of the MONEY AS A WHOLE
//     (each case's mean run, added up): the spec does not say how to add cases up, and the mean of each
//     case's own saving would let the many short conversations decide, where the trim saves little and
//     where little money is. The mean of the cases and each size apart are reported beside it, not hidden.
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
    /** Questions with three judged answers on both sides: the ones the gate could speak for. */
    readonly judged: number;
    readonly pass: boolean;
    readonly broken: readonly BrokenQuestion[];
    /** Questions with fewer than three judged answers on either side: the gate says nothing about them. */
    readonly unjudged: readonly { readonly caseId: string; readonly question: number; readonly todayJudged: number; readonly armJudged: number }[];
  };
  readonly cost: {
    readonly pass: boolean;
    /** Of the money as a whole: what decides. */
    readonly saving: number;
    /** The mean of each case's own saving, every case weighing the same. */
    readonly meanCaseSaving: number;
    /** The saving of the money within each size class. */
    readonly bySize: readonly { readonly size: number; readonly cases: number; readonly saving: number }[];
    readonly firstCallDrop: number;
  };
  /** What entered the count, and what was left out of it. */
  readonly counted: { readonly today: Tally; readonly arm: Tally };
  readonly left: { readonly today: Tally; readonly arm: Tally };
  /** The smallest size class from which no question breaks, at that size or any larger: where the summary's
   *  threshold can sit. `null`: it breaks one at every size. */
  readonly smallestCleanSize: number | null;
  /** Every question of every case was judged: only then does `smallestCleanSize` mean anything (with fewer
   *  than three runs it is `null` because nothing is known, not because every size breaks). */
  readonly thresholdKnown: boolean;
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

  // Each case counts as its mean run (so a case with a run left out weighs the same), and the cases are
  // added up: the saving is of the money, where a long conversation weighs what it costs.
  const cases = [...new Set(valid(input.today).map((run) => run.caseId))].filter((id) => valid(input.arm).some((run) => run.caseId === id));
  const of = (runs: readonly RunResult[], id: string, pick: (run: RunResult) => number) => mean(valid(runs).filter((run) => run.caseId === id).map(pick));
  const sum = (ids: readonly string[], runs: readonly RunResult[], pick: (run: RunResult) => number) => ids.reduce((s, id) => s + of(runs, id, pick), 0);
  const dropOf = (ids: readonly string[], pick: (run: RunResult) => number) => {
    const before = sum(ids, input.today, pick);
    return before > 0 ? 1 - sum(ids, input.arm, pick) / before : 0;
  };
  const cost = (run: RunResult) => run.costUsd;
  const saving = dropOf(cases, cost);
  const meanCaseSaving = mean(cases.filter((id) => of(input.today, id, cost) > 0).map((id) => dropOf([id], cost)));
  const firstCallDrop = dropOf(cases, (run) => run.firstCallTokens);
  const costPass = cases.length > 0 && saving >= COST_SAVING - EPSILON && firstCallDrop >= FIRST_CALL_DROP - EPSILON;

  const sizes = [...new Set(cases.map(input.sizeOf))].sort((a, b) => a - b);
  const bySize = sizes.map((size) => {
    const ids = cases.filter((id) => input.sizeOf(id) === size);
    return { size, cases: ids.length, saving: dropOf(ids, cost) };
  });
  const dirty = new Set(broken.map((b) => input.sizeOf(b.caseId)));
  const judgedQuestions = todayQ.size - unjudged.length;
  const thresholdKnown = judgedQuestions > 0 && unjudged.length === 0;
  const smallestCleanSize = thresholdKnown ? (sizes.find((size) => sizes.filter((s) => s >= size).every((s) => !dirty.has(s))) ?? null) : null;

  const perQuestionPass = broken.length === 0;
  return {
    pass: qualityPass && perQuestionPass && costPass,
    quality: { pass: qualityPass, ...quality },
    perQuestion: { pass: perQuestionPass, judged: judgedQuestions, broken, unjudged },
    cost: { pass: costPass, saving, meanCaseSaving, bySize, firstCallDrop },
    counted: { today: today.counted, arm: arm.counted },
    left: { today: today.left, arm: arm.left },
    smallestCleanSize,
    thresholdKnown,
  };
}

const pct = (x: number): string => `${(x * 100).toFixed(1)} %`;

/** The gates as lines to read: every number that decided, and what was left out. */
export function gateLines(label: string, result: GateResult): string[] {
  const lines = [
    `Brazo ${label}: ${result.pass ? "PASA" : "NO PASA"}`,
    `  calidad en conjunto  ${result.quality.pass ? "pasa" : "NO pasa"} · acierta ${pct(result.quality.arm)} frente a ${pct(result.quality.today)} de «hoy» (margen ${pct(QUALITY_MARGIN)})`,
    result.perQuestion.judged === 0
      ? `  pregunta a pregunta  no se puede decir: ninguna pregunta tiene ${RUNS_TO_JUDGE} respuestas juzgadas en los dos lados`
      : `  pregunta a pregunta  ${result.perQuestion.pass ? "pasa" : "NO pasa"} · ${result.perQuestion.broken.length} rota(s) de ${result.perQuestion.judged} juzgadas`,
    ...result.perQuestion.broken.map((b) => `      ${b.caseId} · pregunta ${b.question + 1} (${b.kind}): «hoy» ${b.todayRight} de 3, el brazo ${b.armRight} de 3`),
    `  coste y mecanismo    ${result.cost.pass ? "pasa" : "NO pasa"} · el dinero en conjunto baja ${pct(result.cost.saving)} (hacen falta ${pct(COST_SAVING)}) · la primera llamada baja ${pct(result.cost.firstCallDrop)}`,
    `      por tamaño real: ${result.cost.bySize.map((s) => `${s.size}k (${s.cases} casos) ${pct(s.saving)}`).join(" · ")} · media de los casos, pesando todos igual: ${pct(result.cost.meanCaseSaving)}`,
    `  contado: ${result.counted.arm.runs} corridas y ${result.counted.arm.questions} respuestas del brazo, ${result.counted.today.runs} y ${result.counted.today.questions} de «hoy»`,
  ];
  const out = result.left.arm.runs + result.left.arm.questions + result.left.today.runs + result.left.today.questions;
  if (out > 0) lines.push(`  fuera de la cuenta por fallos que no son de la respuesta: ${result.left.arm.runs} corridas y ${result.left.arm.questions} respuestas del brazo, ${result.left.today.runs} y ${result.left.today.questions} de «hoy»`);
  if (result.perQuestion.unjudged.length > 0) lines.push(`  ${result.perQuestion.unjudged.length} pregunta(s) con menos de ${RUNS_TO_JUDGE} respuestas juzgadas: la puerta fina no dice nada de ellas`);
  return lines;
}
