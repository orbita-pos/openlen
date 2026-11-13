// THE RUNNER of the return bench (spec local 2026-11-13-conversar-todo-el-mes, §8.2–8.6): what happens, in
// which order, and when it stops. Everything it touches — the route, the database, the provider — comes
// through `World` (./world.ts is the real one), so the order and the stops are tested at $0.
//
// A run, for any arm:
//   1. the case is put back as it was built;
//   2. (summary arm) its summary is written, with the function the idle timer calls;
//   3. the conversation is moved ten hours into the past;
//   4. the three questions are asked through the real route, each graded on what it left;
//   5. after the first one, the rows say whether the route did what the arm claims — if not, the run is out;
//   6. the case is put back again: nothing of the run stays behind.
//
// THE MONEY has two locks. The runner's own: before every run it asks whether what is left covers the run's
// estimate, and stops if not. And the server's: before every turn the owner's balance is set to what is left
// of the cap, so a turn that runs away is stopped by the route itself, as any turn without balance is.
import { ARM_SPECS, mechanismProblem, type Mechanism } from "./arms";
import { runCost, usdOf, type CallUsage, type TokenUsage } from "./cost";
import { grade } from "./grade";
import type { Arm, QuestionResult, ReturnCase, RunResult } from "./types";

/** Where a case lives once it exists. */
export interface Target {
  readonly projectId: string;
  readonly assistantId: string | null;
  /** The conversation the case is held in: the assistant's, or `null` for Len's. */
  readonly conversation: string | null;
}

/** A case whose conversation was built and kept. */
export interface BuiltCase extends Target {
  readonly caseId: string;
  /** Tokens of the built conversation, without the fixed start of a request. */
  readonly tokens: number;
  readonly turns: number;
  /** What building it really cost. */
  readonly spentUsd: number;
  readonly builtAt: string;
}

export interface TurnReply {
  /** What was written to the person. */
  readonly answer: string;
  /** The route's `error` event, if it sent one. */
  readonly error: { readonly code: string; readonly message: string } | null;
}

export interface World {
  createProject(c: ReturnCase): Promise<Target>;
  /** The server's lock: the owner's balance becomes what is left of the cap. */
  allow(usd: number): Promise<void>;
  /** One turn through the real route. */
  ask(target: Target, prompt: string): Promise<TurnReply>;
  /** The project's files now; `/index.html` is the page. */
  files(target: Target): Promise<Record<string, string>>;
  /** The idle summary's job of the conversation's last turn is on file (the building server wrote it). */
  hasCapture(target: Target): Promise<boolean>;
  conversationTokens(target: Target): Promise<number>;
  save(caseId: string, target: Target): Promise<void>;
  restore(caseId: string, target: Target): Promise<void>;
  /** The pause: the conversation ends ten hours ago. */
  age(target: Target): Promise<void>;
  /** The ids of the conversation's rows. */
  rowIds(target: Target): Promise<string[]>;
  /** A point in the recorded calls: what comes after it belongs to the next turn. */
  mark(target: Target): Promise<unknown>;
  callsSince(target: Target, mark: unknown): Promise<(TokenUsage & { readonly step: number })[]>;
  /** What the route left in the rows; `before` are the conversation's rows from before the first question. */
  mechanism(target: Target, before: readonly string[]): Promise<Mechanism>;
  /** Writes the conversation's summary, waiting on its last turn. `outcome` is `runIdleSummary`'s. */
  summarize(built: BuiltCase, run: number): Promise<{ readonly outcome: string; readonly usage: TokenUsage | null }>;
  /** A case that could not be built: its project goes. */
  discard(target: Target): Promise<void>;
}

/** The cap was reached: not an error of any case. */
export class BudgetStop extends Error {}

export class Budget {
  spentUsd: number;
  constructor(
    readonly capUsd: number,
    spentUsd = 0,
  ) {
    this.spentUsd = spentUsd;
  }
  remaining(): number {
    return Math.max(0, this.capUsd - this.spentUsd);
  }
  add(usd: number): void {
    this.spentUsd += usd;
  }
}

/** What every request starts with before the conversation: the system prompt, the manual and the tools. */
export const FIXED_START_TOKENS = 24_000;
/** What a turn may cost beyond the cold return's first call: its other calls, its answer, a re-read. */
const TURN_ALLOWANCE_USD = 0.01;
/** What a summary may write. */
const SUMMARY_OUTPUT_TOKENS = 4_000;

/** What a run may cost at its worst, for asking BEFORE it starts whether it fits: the whole conversation
 *  sent with nothing cached, whatever the arm — the trim's saving is what is being measured, not assumed. */
export function estimateRunUsd(conversationTokens: number, arm: Arm): number {
  const whole = conversationTokens + FIXED_START_TOKENS;
  const questions = usdOf({ inputTokens: whole, cachedTokens: 0, outputTokens: 0 }) + 3 * TURN_ALLOWANCE_USD;
  return ARM_SPECS[arm].summary ? questions + usdOf({ inputTokens: whole, cachedTokens: 0, outputTokens: SUMMARY_OUTPUT_TOKENS }) : questions;
}

/** What building a case may cost: every message as a turn that sends the conversation it will end with. */
export function estimateBuildUsd(c: ReturnCase): number {
  const whole = c.targetKTokens * 1_000 + FIXED_START_TOKENS;
  // The conversation grows from nothing to its size, mostly read from the cache: half of it uncached, once
  // per message, is well above what a built case has cost in production.
  return c.build.length * (usdOf({ inputTokens: whole / 2, cachedTokens: 0, outputTokens: 2_000 }) + TURN_ALLOWANCE_USD);
}

const failedTurn = (reply: TurnReply): string | null => (reply.error && reply.answer.trim() === "" ? `${reply.error.code}: ${reply.error.message}` : null);

/** One turn with the money counted: the server's lock set, the turn asked, its calls added to the budget. */
async function turn(world: World, target: Target, prompt: string, budget: Budget): Promise<{ reply: TurnReply; calls: (TokenUsage & { step: number })[] }> {
  await world.allow(budget.remaining());
  const mark = await world.mark(target);
  const reply = await world.ask(target, prompt);
  const calls = await world.callsSince(target, mark);
  budget.add(calls.reduce((sum, call) => sum + usdOf(call), 0));
  if (reply.error?.code === "no_credits") throw new BudgetStop(`the route refused the turn: the balance set from the cap ($${budget.capUsd.toFixed(2)}) ran out`);
  return { reply, calls };
}

/**
 * Builds a case's conversation with real turns and keeps it. Half a conversation is not a case: a message
 * the route could not answer stops the building and the project goes.
 */
export async function buildCase(c: ReturnCase, world: World, budget: Budget): Promise<BuiltCase> {
  const target = await world.createProject(c);
  try {
    let spentUsd = 0;
    for (const [i, message] of c.build.entries()) {
      const { reply, calls } = await turn(world, target, message, budget);
      spentUsd += calls.reduce((sum, call) => sum + usdOf(call), 0);
      const failed = failedTurn(reply);
      if (failed) throw new Error(`${c.id}: message ${i + 1} of ${c.build.length} could not be answered — ${failed}`);
    }
    if (!(await world.hasCapture(target))) {
      throw new Error(
        `${c.id}: the idle summary's job was not written to a file. The server must be the BUILDING one: OPENLEN_IDLE_SUMMARY_CAPTURE_DIR set and OPENLEN_IDLE_SUMMARY_MIN_TOKENS=1.`,
      );
    }
    const tokens = await world.conversationTokens(target);
    await world.save(c.id, target);
    return { ...target, caseId: c.id, tokens, turns: c.build.length, spentUsd, builtAt: new Date().toISOString() };
  } catch (err) {
    await world.discard(target).catch(() => {});
    throw err;
  }
}

/** One run of a case under an arm. Throws only `BudgetStop`; anything else that goes wrong is in the result. */
export async function runOnce(c: ReturnCase, built: BuiltCase, arm: Arm, run: number, world: World, budget: Budget): Promise<RunResult> {
  const started = Date.now();
  const calls: CallUsage[] = [];
  const questions: QuestionResult[] = [];
  let summary: TokenUsage | null = null;
  let infra: string | undefined;
  await world.restore(c.id, built);
  try {
    if (ARM_SPECS[arm].summary) {
      await world.allow(budget.remaining());
      const written = await world.summarize(built, run);
      summary = written.usage;
      if (written.usage) budget.add(usdOf(written.usage));
      if (written.outcome !== "saved") infra = `the summary was not written: ${written.outcome}`;
    }
    if (!infra) {
      await world.age(built);
      const before = await world.rowIds(built);
      for (const [i, question] of c.questions.entries()) {
        const { reply, calls: made } = await turn(world, built, question.prompt, budget);
        calls.push(...made.map((call) => ({ ...call, question: i })));
        const failed = failedTurn(reply);
        if (failed && i === 0) {
          infra = `the cold return could not be answered — ${failed}`;
          break;
        }
        if (failed) {
          questions.push({ kind: question.kind, pass: false, failed: [], infra: failed });
          continue;
        }
        questions.push(grade(question, { answer: reply.answer, files: await world.files(built) }));
        if (i === 0) {
          const problem = mechanismProblem(arm, await world.mechanism(built, before));
          if (problem) {
            infra = problem;
            break;
          }
        }
      }
    }
  } finally {
    // Nothing of the run stays: the next one starts from the case, and no timer finds a row of this one.
    await world.restore(c.id, built);
  }
  const cost = runCost(calls, summary);
  return { caseId: c.id, arm, run, questions, ...(infra ? { infra } : {}), ...cost, seconds: (Date.now() - started) / 1000 };
}

/** Where an arm's runs are kept, one by one as they end. */
export interface RunStore {
  load(): readonly RunResult[];
  append(result: RunResult): void;
}

export interface ArmOptions {
  readonly cases: readonly ReturnCase[];
  readonly builds: ReadonlyMap<string, BuiltCase>;
  readonly arm: Arm;
  /** Runs per case. */
  readonly runs: number;
  readonly budget: Budget;
  readonly world: World;
  readonly store: RunStore;
  /** Run again the runs that were left out of the count. */
  readonly retryInfra?: boolean;
  readonly log: (line: string) => void;
}

/**
 * Every case, `runs` times, under one arm. Goes on from what the store already has. `cap`: it stopped
 * before a run that might not fit under what is left, or the server refused a turn for lack of balance.
 */
export async function runArm(o: ArmOptions): Promise<"done" | "cap"> {
  const unbuilt = o.cases.filter((c) => !o.builds.has(c.id));
  if (unbuilt.length > 0) throw new Error(`${unbuilt.map((c) => c.id).join(", ")}: not built — build the cases first`);
  for (const c of o.cases) {
    const built = o.builds.get(c.id)!;
    for (let run = 1; run <= o.runs; run++) {
      const kept = o.store.load().filter((r) => r.caseId === c.id && r.arm === o.arm && r.run === run);
      if (kept.some((r) => !r.infra) || (kept.length > 0 && !o.retryInfra)) continue;
      const estimate = estimateRunUsd(built.tokens, o.arm);
      if (o.budget.remaining() < estimate) {
        o.log(`cap: ${c.id} #${run} may cost $${estimate.toFixed(3)} and $${o.budget.remaining().toFixed(3)} is left of $${o.budget.capUsd.toFixed(2)}`);
        return "cap";
      }
      let result: RunResult;
      try {
        result = await runOnce(c, built, o.arm, run, o.world, o.budget);
      } catch (err) {
        if (err instanceof BudgetStop) {
          o.log(`cap: ${err.message}`);
          return "cap";
        }
        throw err;
      }
      o.store.append(result);
      const marks = result.questions.map((q) => (q.infra ? "?" : q.pass ? "✓" : "✗")).join("");
      o.log(
        `${c.id} #${run} [${ARM_SPECS[o.arm].label}] ${result.infra ? `OUT: ${result.infra}` : marks} · first call ${result.firstCallTokens} tokens · cost $${result.costUsd.toFixed(4)} · spent $${result.spentUsd.toFixed(4)} · ${result.seconds.toFixed(0)} s`,
      );
    }
  }
  return "done";
}
