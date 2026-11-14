// What the return bench keeps on disk, and the few numbers that are the bench's own. Local, never in the
// repo: `/plans/` is ignored.
import fs from "node:fs";
import path from "node:path";
import type { BuiltCase, RunStore } from "./runner";
import type { Arm, RunResult } from "./types";

export const BENCH_DIR = path.join("plans", "conversar-todo-el-mes", "bench");
/** Where the bench's server writes the idle summary's job of each conversation (lib/agent/idle-summary-capture.ts). */
export const capturesDir = (dir: string): string => path.join(dir, "captures");

/** How far back the conversation is moved: Jesús's own case, «un mensaje dentro de 10 horas». */
export const PAUSE_MS = 10 * 3_600_000;
/** The smallest threshold the measurement has to decide about (spec §8.5). */
export const SMALLEST_THRESHOLD_TOKENS = 40_000;

/** From what size the bench's summary is written: the smallest candidate threshold, lowered just enough for
 *  a case that came out a little under it. The literal tail it keeps follows from it, as in production — so
 *  every case is summarized at least as hard as the smallest threshold would. */
export function benchIdleMinTokens(conversationTokens: number): number {
  return Math.max(1, Math.min(SMALLEST_THRESHOLD_TOKENS, Math.floor(conversationTokens * 0.9)));
}

/** The size a conversation is filed under in the report, in thousands of tokens: what it really weighs, to
 *  the nearest ten thousand. */
export function sizeClassK(tokens: number): number {
  return Math.max(10, Math.round(tokens / 10_000) * 10);
}

/** The size class of each case for the report: the one of what was BUILT. A case's name carries the size it
 *  was aimed at («…-220k»), and a build can come out far from it; the label is used only for a case that was
 *  never built. */
export function builtSizeOf(builds: ReadonlyMap<string, BuiltCase>, targetKOf: (caseId: string) => number): (caseId: string) => number {
  return (caseId) => {
    const built = builds.get(caseId);
    return built ? sizeClassK(built.tokens) : targetKOf(caseId);
  };
}

function readJson<T>(file: string, fallback: T): T {
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as T) : fallback;
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}

/** The cases that are built, by id. */
export function loadBuilds(dir: string): Map<string, BuiltCase> {
  return new Map(readJson<BuiltCase[]>(path.join(dir, "cases.json"), []).map((b) => [b.caseId, b]));
}

/** Keeps a built case's record; building it again replaces the one that was there. */
export function keepBuild(dir: string, built: BuiltCase): void {
  const all = loadBuilds(dir);
  all.set(built.caseId, built);
  writeJson(path.join(dir, "cases.json"), [...all.values()]);
}

/** The bench's own copy of a built case's idle-summary job: the server's file is overwritten by every later
 *  turn of the conversation, a question's included. */
export const jobFile = (dir: string, caseId: string): string => path.join(dir, "jobs", `${caseId}.json`);

/** A step of the measurement that is paid for with its own cap (spec §8.6). */
export type Step = "build" | Arm;

/** What a step has spent so far, across every command that ran it: its cap is the step's, so a command that
 *  died and is run again goes on from here instead of starting a fresh one. */
export function loadSpend(dir: string, step: Step): number {
  return readJson<Partial<Record<Step, number>>>(path.join(dir, "spend.json"), {})[step] ?? 0;
}

export function addSpend(dir: string, step: Step, usd: number): void {
  const file = path.join(dir, "spend.json");
  const all = readJson<Partial<Record<Step, number>>>(file, {});
  writeJson(file, { ...all, [step]: (all[step] ?? 0) + usd });
}

export const runsFile = (dir: string, arm: Arm): string => path.join(dir, `runs-${arm}.json`);

/** An arm's runs, in a file written whole after each one: a bench that is killed has lost nothing it paid for. */
export function runStore(dir: string, arm: Arm): RunStore {
  const file = runsFile(dir, arm);
  return {
    load: () => readJson<RunResult[]>(file, []),
    append(result) {
      writeJson(file, [...readJson<RunResult[]>(file, []), result]);
    },
  };
}

/** The runs that count for a report: for each case and run number, the last one kept (a run that was left
 *  out and run again is replaced by its second go). */
export function latestRuns(runs: readonly RunResult[]): RunResult[] {
  const last = new Map<string, RunResult>();
  for (const run of runs) last.set(`${run.caseId}#${run.run}`, run);
  return [...last.values()];
}
