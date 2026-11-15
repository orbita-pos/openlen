// lib/len-bench/run-store.ts — each run kept as it ends, so a suite resumes by (case, run).
//
// Spec local 2026-11-12-len-3-1-ruta, §5 piece 5: «reanudar por (caso, corrida); los fallos de infraestructura
// en un fichero aparte y fuera de la media», the shape of Claude Code's runner scaffold. The return bench does
// the same (cold-return/store.ts). A paid column of 25 cases × 3 runs that dies at run 60 is resumed, not paid
// twice: the runs Len finished are read back, those the harness could not measure run again.
import fs from "node:fs";
import path from "node:path";

import { DEL_ARNES } from "./puntuar";
import type { Desenlace, ResultadoDeCaso, ResultadoDeCorrida } from "./tipos";

const RUNS_DIR = "runs";
const FILE = /^(.+)-(\d+)\.json$/;

/** The key of one run: the file's name without `.json`. */
export function runKey(caseId: string, run: number): string {
  return `${caseId}-${run}`;
}

/** Writes one run as it ends: `<dir>/runs/<caseId>-<run>.json` (runs counted from 1). */
export function saveRun(dir: string, caseId: string, run: number, r: ResultadoDeCorrida): void {
  const runs = path.join(dir, RUNS_DIR);
  fs.mkdirSync(runs, { recursive: true });
  fs.writeFileSync(path.join(runs, `${runKey(caseId, run)}.json`), JSON.stringify(r, null, 2));
}

/** The runs a resumed suite skips: those Len finished. Those the harness could not measure are left out, so
 *  they run again. */
export function keptRuns(dir: string): Map<string, ResultadoDeCorrida> {
  const runs = path.join(dir, RUNS_DIR);
  const kept = new Map<string, ResultadoDeCorrida>();
  if (!fs.existsSync(runs)) return kept;
  for (const name of fs.readdirSync(runs)) {
    const m = FILE.exec(name);
    if (!m) continue;
    const r = JSON.parse(fs.readFileSync(path.join(runs, name), "utf8")) as ResultadoDeCorrida;
    if (!DEL_ARNES.has(r.desenlace)) kept.set(runKey(m[1]!, Number(m[2])), r);
  }
  return kept;
}

export interface InfraFailure {
  readonly caseId: string;
  /** Counted from 1, as in the run's file name. */
  readonly run: number;
  readonly desenlace: Desenlace;
  readonly error?: string;
}

/** What goes to `infraestructura.json`: the runs out of the mean, by case and run. */
export function infraFailures(casos: readonly ResultadoDeCaso[]): InfraFailure[] {
  return casos.flatMap((c) =>
    c.corridas.flatMap((r, i) => (DEL_ARNES.has(r.desenlace) ? [{ caseId: c.id, run: i + 1, desenlace: r.desenlace, ...(r.error ? { error: r.error } : {}) }] : [])),
  );
}

const SPEND_FILE = "gasto.json";

/** What a column has spent so far, across every invocation (review I1: the cap is per PASS, spec §7.5, and a
 *  resumed pass used to start counting from $0). Infra-failure runs are paid too: they count here even though
 *  their run file is overwritten when they run again. */
export function spentSoFar(dir: string): number {
  const file = path.join(dir, SPEND_FILE);
  if (!fs.existsSync(file)) return 0;
  const total = (JSON.parse(fs.readFileSync(file, "utf8")) as { totalUsd?: unknown }).totalUsd;
  return typeof total === "number" && Number.isFinite(total) ? total : 0;
}

/** Adds what one run cost to the column's spend, as soon as it ends. */
export function recordSpend(dir: string, usd: number): void {
  if (!Number.isFinite(usd) || usd <= 0) return;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, SPEND_FILE), JSON.stringify({ totalUsd: spentSoFar(dir) + usd }, null, 2));
}

/** The cost of one case run, from a PILOT's kept runs (spec §5 piece 5: «el estimado desde el piloto en lugar
 *  de la constante de hoy»; Anthropic: estimates from logs «are routinely 2-4× off»). The harness's runs are
 *  left out, as from the mean. */
export function estimateFromPilot(pilotDir: string): { usdPerCaseRun: number; runs: number } {
  const runs = [...keptRuns(pilotDir).values()].filter((r) => r.desenlace !== "tope_de_gasto");
  if (runs.length === 0) throw new Error(`no hay corridas del piloto en ${pilotDir}: el estimado sale de un piloto corrido`);
  return { usdPerCaseRun: runs.reduce((s, r) => s + r.usd, 0) / runs.length, runs: runs.length };
}

/** Two suites never share a folder by accident: a folder with runs is only reused by `--reanudar`, and
 *  `--reanudar` on a folder with none is a typo that would start from zero. */
export function runsDirProblem(dir: string, resuming: boolean): string | null {
  const runs = path.join(dir, RUNS_DIR);
  const has = fs.existsSync(runs) && fs.readdirSync(runs).some((n) => FILE.test(n));
  if (has && !resuming) return `ya hay corridas en ${dir}: vuelve a correr con --reanudar=${dir}, o usa otra --etiqueta`;
  if (!has && resuming) return `no hay corridas que reanudar en ${dir}`;
  return null;
}
