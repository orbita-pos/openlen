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
