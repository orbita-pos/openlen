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

/** Two suites never share a folder by accident: a folder with runs is only reused by `--reanudar`, and
 *  `--reanudar` on a folder with none is a typo that would start from zero. */
export function runsDirProblem(dir: string, resuming: boolean): string | null {
  const runs = path.join(dir, RUNS_DIR);
  const has = fs.existsSync(runs) && fs.readdirSync(runs).some((n) => FILE.test(n));
  if (has && !resuming) return `ya hay corridas en ${dir}: vuelve a correr con --reanudar=${dir}, o usa otra --etiqueta`;
  if (!has && resuming) return `no hay corridas que reanudar en ${dir}`;
  return null;
}
