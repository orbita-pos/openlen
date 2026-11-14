// THE RUNNER of the return bench (spec local 2026-11-13-conversar-todo-el-mes, §8.2–8.6): what happens, in
// which order, and when it stops. Everything it touches — the route, the database, the provider — comes
// through `World` (./world.ts is the real one), so the order and the stops are tested at $0.
//
// A run, for any arm:
//   1. the case is put back as it was built;
//   2. (summary arm) its summary is written, with the function the idle timer calls;
//   3. the conversation is moved ten hours into the past;
//   4. the three questions are asked through the real route, each graded on what it left;
//   5. after the first one, the rows say whether the route did what the arm claims — if not, the run is out
//      and THE ARM STOPS: a server started wrong repeats in every run;
//   6. the case is put back again: nothing of the run stays behind.
//
// THE MONEY has two locks that do not depend on each other. The runner's own: it counts what each turn's
// calls cost and stops before a run that might not fit under what is left. And the server's: the owner's
// balance is opened at the cap when the command starts and only ever lowered (./balance.ts), so the route
// itself stops a turn that runs away — also when the runner's count is wrong. A turn the route answered
// with NO call recorded, or with a call by another provider, stops everything: the count would be a lie.
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

/** What the cold return's trim does to a conversation, read off its history without a model. */
export interface TrimEffect {
  readonly tokensBefore: number;
  readonly tokensAfter: number;
  /** Results emptied. Zero = only what was thought went: the «old result» question asks nothing new there. */
  readonly resultsCleared: number;
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
  readonly trim?: TrimEffect;
}

export interface TurnReply {
  /** What was written to the person. */
  readonly answer: string;
  /** Why the turn did not end well, if it did not: the route's `error` event, how its row ended
   *  (`budget_limit`), or the request itself failing (`transport`, `timeout`). */
  readonly error: { readonly code: string; readonly message: string } | null;
}

/** One call to the provider, as the route recorded it. */
export interface RecordedCall extends TokenUsage {
  readonly step: number;
  readonly provider: string;
  /** The provider said what it used. A call that failed before answering did not. */
  readonly reported: boolean;
}

export interface World {
  createProject(c: ReturnCase): Promise<Target>;
  /** The server's lock: the owner's balance is lowered to this. Never raised (./balance.ts). */
  allow(usd: number): Promise<void>;
  /** One turn through the real route. `slow`: a turn that builds, which may take longer. */
  ask(target: Target, prompt: string, o?: { readonly slow?: boolean }): Promise<TurnReply>;
  /** The project's files now; `/index.html` is the page. */
  files(target: Target): Promise<Record<string, string>>;
  /** What is wrong with the idle summary's job on file for this conversation, or `null` when it is there and
   *  is its LAST turn's. The building server writes it at the end of every turn. */
  jobProblem(target: Target): Promise<string | null>;
  /** The bench's own copy of that job, by case: later turns of the conversation overwrite the server's. */
  keepJob(caseId: string, target: Target): Promise<void>;
  conversationTokens(target: Target): Promise<number>;
  trimEffect(target: Target): Promise<TrimEffect>;
  save(caseId: string, target: Target): Promise<void>;
  restore(caseId: string, target: Target): Promise<void>;
  /** The pause: the conversation ends ten hours ago. */
  age(target: Target): Promise<void>;
  /** The ids of the conversation's rows. */
  rowIds(target: Target): Promise<string[]>;
  /** A point in the recorded calls: what comes after it belongs to the next turn. */
  mark(target: Target): Promise<unknown>;
  callsSince(target: Target, mark: unknown): Promise<RecordedCall[]>;
  /** What the route left in the rows; `before` are the conversation's rows from before the first question. */
  mechanism(target: Target, before: readonly string[]): Promise<Mechanism>;
  /** Writes the conversation's summary, waiting on its last turn. `outcome` is `runIdleSummary`'s. */
  summarize(built: BuiltCase, run: number): Promise<{ readonly outcome: string; readonly usage: TokenUsage | null }>;
  /** A case that could not be built: its project goes. */
  discard(target: Target): Promise<void>;
}

/** The cap was reached: not an error of any case. */
export class BudgetStop extends Error {}

/** The bench's server is not the one this step needs, or does not record what the bench counts with. It
 *  repeats in every turn, so everything stops at the first sign of it. */
export class SetupStop extends Error {}

export class Budget {
  spentUsd: number;
  /**
   * @param spentUsd what this step had already spent in earlier commands: the cap is the step's, not the
   *   command's (a command that died and is run again does not start a fresh one).
   * @param onAdd told every amount as it is counted, to keep it.
   */
  constructor(
    readonly capUsd: number,
    spentUsd = 0,
    private readonly onAdd?: (usd: number) => void,
  ) {
    this.spentUsd = spentUsd;
  }
  remaining(): number {
    return Math.max(0, this.capUsd - this.spentUsd);
  }
  add(usd: number): void {
    if (usd <= 0) return;
    this.spentUsd += usd;
    this.onAdd?.(usd);
  }
}

/** What every request starts with before the conversation: the system prompt, the manual and the tools. */
export const FIXED_START_TOKENS = 24_000;
/** What a turn may cost beyond the cold return's first call: its other calls, its answer, a re-read. */
const TURN_ALLOWANCE_USD = 0.01;
/** What a summary may write. */
const SUMMARY_OUTPUT_TOKENS = 4_000;
/** The only provider the bench's server may answer with: its price is the one everything is counted at. */
const PROVIDER = "deepinfra";

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

/** Why a turn left nothing to judge, or `null`: it failed AND wrote nothing to the person. */
const failedTurn = (reply: TurnReply): string | null => (reply.error && reply.answer.trim() === "" ? `${reply.error.code}: ${reply.error.message}` : null);

interface CountedTurn {
  readonly reply: TurnReply;
  readonly calls: RecordedCall[];
  readonly usd: number;
}

/** One turn with the money counted: the server's lock lowered, the turn asked, its calls added to the budget. */
async function turn(world: World, target: Target, prompt: string, budget: Budget, o?: { slow?: boolean }): Promise<CountedTurn> {
  await world.allow(budget.remaining());
  const mark = await world.mark(target);
  const reply = await world.ask(target, prompt, o);
  const calls = await world.callsSince(target, mark);
  const usd = calls.reduce((sum, call) => sum + (call.reported ? usdOf(call) : 0), 0);
  budget.add(usd);
  const foreign = calls.find((call) => call.provider !== PROVIDER);
  if (foreign) {
    throw new SetupStop(`a call was answered by ${foreign.provider}: the bench counts ${PROVIDER}'s price and nothing else. Start the bench's server with OPENLEN_AGENT_PROVIDERS=${PROVIDER}.`);
  }
  if (reply.error?.code === "no_credits" || reply.error?.code === "budget_limit") {
    throw new BudgetStop(`the route stopped for lack of balance (${reply.error.code}): the balance opened at the cap ($${budget.capUsd.toFixed(2)}) ran out`);
  }
  if (calls.length === 0 && failedTurn(reply) === null) {
    throw new SetupStop(
      "the route answered a turn and recorded no call for it (agentRequestSteps): the bench cannot count what it spends. Start the bench's server without OPENLEN_STEP_TELEMETRY=0, on a database that has that table.",
    );
  }
  return { reply, calls, usd };
}

/**
 * Builds a case's conversation with real turns and keeps it. Half a conversation is not a case: a message
 * the route could not answer stops the building and the project goes. After the FIRST message the server is
 * checked — it has to be the building one — so a wrong server costs one turn, not a whole case.
 */
export async function buildCase(c: ReturnCase, world: World, budget: Budget): Promise<BuiltCase> {
  const target = await world.createProject(c);
  try {
    let spentUsd = 0;
    for (const [i, message] of c.build.entries()) {
      const { reply, usd } = await turn(world, target, message, budget, { slow: true });
      spentUsd += usd;
      const failed = failedTurn(reply);
      if (failed) throw new Error(`${c.id}: message ${i + 1} of ${c.build.length} could not be answered — ${failed}`);
      if (i === 0) {
        const job = await world.jobProblem(target);
        if (job) throw new SetupStop(`${c.id}: ${job}. The server must be the BUILDING one: OPENLEN_IDLE_SUMMARY_CAPTURE_DIR set and OPENLEN_IDLE_SUMMARY_MIN_TOKENS=1.`);
        if ((await world.mechanism(target, [])).sandboxRows > 0) throw new SetupStop(`${c.id}: a box of the real terminal was opened: the bench's server must be started with OPENLEN_SANDBOX=0`);
      }
    }
    const job = await world.jobProblem(target);
    if (job) throw new Error(`${c.id}: ${job}`);
    const tokens = await world.conversationTokens(target);
    const trim = await world.trimEffect(target);
    await world.keepJob(c.id, target);
    await world.save(c.id, target);
    return { ...target, caseId: c.id, tokens, turns: c.build.length, spentUsd, builtAt: new Date().toISOString(), trim };
  } catch (err) {
    await world.discard(target).catch(() => {});
    throw err;
  }
}

/**
 * One run of a case under an arm. Throws `BudgetStop` and `SetupStop`; anything else that goes wrong is in
 * the result. A result whose `infraKind` is `setup` means the arm's mechanism did not happen: the caller
 * keeps it and stops.
 */
export async function runOnce(c: ReturnCase, built: BuiltCase, arm: Arm, run: number, world: World, budget: Budget): Promise<RunResult> {
  const started = Date.now();
  const calls: CallUsage[] = [];
  const questions: QuestionResult[] = [];
  let summary: TokenUsage | null = null;
  let infra: { why: string; kind: NonNullable<RunResult["infraKind"]> } | null = null;
  let unreported = 0;
  await world.restore(c.id, built);
  try {
    if (ARM_SPECS[arm].summary) {
      await world.allow(budget.remaining());
      const written = await world.summarize(built, run);
      summary = written.usage;
      if (written.usage) budget.add(usdOf(written.usage));
      if (written.outcome !== "saved") infra = { why: `the summary was not written: ${written.outcome}`, kind: "summary" };
    }
    if (!infra) {
      await world.age(built);
      const before = await world.rowIds(built);
      for (const [i, question] of c.questions.entries()) {
        const { reply, calls: made } = await turn(world, built, question.prompt, budget);
        unreported += made.filter((call) => !call.reported).length;
        calls.push(...made.filter((call) => call.reported).map((call) => ({ ...call, question: i })));
        const failed = failedTurn(reply);
        if (failed && i === 0) {
          infra = { why: `the cold return could not be answered — ${failed}`, kind: "provider" };
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
            infra = { why: problem, kind: "setup" };
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
  return {
    caseId: c.id,
    arm,
    run,
    questions,
    ...(infra ? { infra: infra.why, infraKind: infra.kind } : {}),
    ...cost,
    ...(unreported > 0 ? { unreportedCalls: unreported } : {}),
    seconds: (Date.now() - started) / 1000,
  };
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
 * before a run that might not fit under what is left, or the route stopped a turn for lack of balance.
 * Throws `SetupStop` when the server is not the arm's: the run that showed it is kept, out of the count.
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
        `${c.id} #${run} [${ARM_SPECS[o.arm].label}] ${result.infra ? `OUT: ${result.infra}` : marks} · first call ${result.firstCallTokens} tokens · cost $${result.costUsd.toFixed(4)} · spent $${result.spentUsd.toFixed(4)} · ${result.seconds.toFixed(0)} s${result.unreportedCalls ? ` · ${result.unreportedCalls} call(s) with no usage` : ""}`,
      );
      if (result.infraKind === "setup") throw new SetupStop(`${c.id} #${run}: ${result.infra}`);
    }
  }
  return "done";
}
