// lib/len-bench/table.ts — THE LEN 3.1 TABLE, from two columns of runs.
//
// Spec local 2026-11-12-len-3-1-ruta, §4: «una tabla del flujo que usan los clientes —crear una página, seguir
// editándola y publicarla— medida con el mismo corredor y los mismos casos sobre 92f4f7e21 y sobre el candidato,
// con el ± de cada fila escrito antes de correrla». No threshold: a row that does not leave the noise says so,
// and it is still the table. Underneath, what the table does not cover, as Anthropic does.
import fs from "node:fs";
import path from "node:path";

import { DEL_ARNES } from "./puntuar";
import type { ResultadoDeCorrida } from "./tipos";

export interface RunOfColumn {
  readonly caseId: string;
  /** Counted from 1, as in the run's file name. */
  readonly run: number;
  readonly result: ResultadoDeCorrida;
}

const FILE = /^(.+)-(\d+)\.json$/;

/** Every run a column kept (`run-store.ts`), the harness's included: the table counts them apart. */
export function allRuns(dir: string): RunOfColumn[] {
  const runs = path.join(dir, "runs");
  if (!fs.existsSync(runs)) return [];
  return fs
    .readdirSync(runs)
    .map((name) => [name, FILE.exec(name)] as const)
    .filter((x): x is readonly [string, RegExpExecArray] => x[1] !== null)
    .map(([name, m]) => ({ caseId: m[1]!, run: Number(m[2]), result: JSON.parse(fs.readFileSync(path.join(runs, name), "utf8")) as ResultadoDeCorrida }))
    .sort((a, b) => (a.caseId === b.caseId ? a.run - b.run : a.caseId < b.caseId ? -1 : 1));
}

export interface Column {
  readonly runs: readonly RunOfColumn[];
}

export function columnOf(runs: readonly RunOfColumn[]): Column {
  return { runs };
}

export interface TableRow {
  readonly fila: string;
  readonly base: string;
  readonly candidato: string;
  readonly ruido: string;
}

// Spanish numbers, as the rest of the spec's tables.
const num = (n: number, decimals: number) => n.toFixed(decimals).replace(".", ",");
const pct = (part: number, whole: number) => (whole === 0 ? "—" : `${part} de ${whole} (${num((100 * part) / whole, 1)} %)`);

/** Linear interpolation between the closest ranks, as Postgres' percentile_cont. */
function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const rank = p * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (rank - lo);
}
const mean = (values: readonly number[]) => (values.length === 0 ? Number.NaN : values.reduce((s, v) => s + v, 0) / values.length);
const triple = (values: readonly number[], f: (n: number) => string) => (values.length === 0 ? "—" : `${f(mean(values))} · ${f(percentile(values, 0.5))} · ${f(percentile(values, 0.9))}`);

/** Len's runs: what the harness could not measure is counted apart, never in a mean (puntuar.ts). */
const lensRuns = (c: Column) => c.runs.filter((r) => !DEL_ARNES.has(r.result.desenlace) && r.result.desenlace !== "tope_de_gasto");

/**
 * The noise of a CONTINUOUS row, as the spec asks: «la barra que vale es la que den las 3 corridas de la columna de
 * referencia» — the metric per run number (all cases' run 1, all cases' run 2…), and half the spread between them.
 */
function spreadByRun(c: Column, metric: (rs: readonly ResultadoDeCorrida[]) => number, f: (n: number) => string): string {
  const byRun = new Map<number, ResultadoDeCorrida[]>();
  for (const r of lensRuns(c)) byRun.set(r.run, [...(byRun.get(r.run) ?? []), r.result]);
  const values = [...byRun.values()].map(metric).filter((v) => Number.isFinite(v));
  if (values.length < 2) return "— (hace falta más de una corrida por caso)";
  return `±${f((Math.max(...values) - Math.min(...values)) / 2)} (entre corridas de la base)`;
}

export function tableRows(base: Column, candidate: Column, o: { readonly publishingCases: ReadonlySet<string> }): TableRow[] {
  const each = (f: (c: Column) => string) => ({ base: f(base), candidato: f(candidate) });
  const passed = (c: Column) => lensRuns(c).filter((r) => r.result.score >= 1).length;
  const publishing = (c: Column) => lensRuns(c).filter((r) => o.publishingCases.has(r.caseId));
  const usd = (rs: readonly ResultadoDeCorrida[]) => rs.map((r) => r.usd);
  const n = lensRuns(base).length;
  return [
    {
      fila: "Encargos terminados (todos los graders que votan en verde, sobre la página publicada)",
      ...each((c) => pct(passed(c), lensRuns(c).length)),
      ruido: n === 0 ? "—" : `±${num(100 / Math.sqrt(n), 1)} pts`,
    },
    {
      // Review I2: «sin rechazo» needs a publish that HAPPENED (len-publico passed) and none rejected; a run with
      // nothing measured (an error before grading) is said apart, never counted as a success.
      fila: "Publica sin rechazo de `publish` (F2), en los casos donde Len publicó",
      ...each((c) => {
        const medidas = publishing(c).filter((r) => r.result.publishRechazados !== undefined);
        const bien = medidas.filter((r) => r.result.publishRechazados === 0 && r.result.graders.some((g) => g.nombre === "len-publico" && g.paso)).length;
        const sinMedir = publishing(c).length - medidas.length;
        return `${pct(bien, medidas.length)}${sinMedir > 0 ? ` · ${sinMedir} sin medir` : ""}`;
      }),
      ruido: publishing(base).length === 0 ? "—" : `±${num(100 / Math.sqrt(publishing(base).length), 1)} pts`,
    },
    {
      fila: "Coste por encargo, $ a precio de lista (media · p50 · p90)",
      ...each((c) => triple(usd(lensRuns(c).map((r) => r.result)), (v) => `$${num(v, 4)}`)),
      ruido: spreadByRun(base, (rs) => mean(usd(rs)), (v) => `$${num(v, 4)}`),
    },
    {
      fila: "Coste por encargo TERMINADO, $ (lo gastado entre los terminados)",
      ...each((c) => (passed(c) === 0 ? "—" : `$${num(usd(lensRuns(c).map((r) => r.result)).reduce((s, v) => s + v, 0) / passed(c), 4)}`)),
      ruido: "—",
    },
    {
      fila: "Llamadas al modelo por encargo (media · p50 · p90)",
      ...each((c) => triple(lensRuns(c).map((r) => r.result.pasos ?? Number.NaN).filter(Number.isFinite), (v) => num(v, 0))),
      ruido: spreadByRun(base, (rs) => mean(rs.map((r) => r.pasos ?? Number.NaN).filter(Number.isFinite)), (v) => num(v, 1)),
    },
    {
      fila: "Minutos por encargo (media · p50 · p90) (F6)",
      ...each((c) => triple(lensRuns(c).map((r) => r.result.segundos / 60), (v) => num(v, 1))),
      ruido: spreadByRun(base, (rs) => mean(rs.map((r) => r.segundos / 60)), (v) => num(v, 1)),
    },
    {
      fila: "Entrada leída de caché, % (media por encargo)",
      ...each((c) => {
        const v = lensRuns(c).map((r) => r.result.cacheLeida ?? Number.NaN).filter(Number.isFinite);
        return v.length === 0 ? "—" : `${num(100 * mean(v), 1)} %`;
      }),
      ruido: spreadByRun(base, (rs) => 100 * mean(rs.map((r) => r.cacheLeida ?? Number.NaN).filter(Number.isFinite)), (v) => `${num(v, 1)} pts`),
    },
    {
      fila: "Escrituras sin leer antes (F3)",
      ...each((c) => (lensRuns(c).length === 0 ? "—" : `${num(mean(lensRuns(c).map((r) => r.result.noLeidos ?? 0)), 2)} por encargo`)),
      ruido: spreadByRun(base, (rs) => mean(rs.map((r) => r.noLeidos ?? 0)), (v) => num(v, 2)),
    },
    {
      fila: "Bucles: corridas con llamadas repetidas (F4)",
      ...each((c) => `${lensRuns(c).filter((r) => (r.result.repeticiones ?? 0) > 0).length} de ${lensRuns(c).length} corridas`),
      ruido: "recuento",
    },
    {
      fila: "Turnos que no terminan: de Len (error) · del arnés (proveedor, cliente fuera de ficha, reloj del banco)",
      ...each((c) => `${c.runs.filter((r) => r.result.desenlace === "error_de_len").length} de Len · ${c.runs.filter((r) => DEL_ARNES.has(r.result.desenlace)).length} del arnés`),
      ruido: "recuento",
    },
    {
      fila: "Tarea programada (F1): tokens de entrada y créditos por ejecución — de producción, a $0",
      base: "230 mil · ~7 créditos (foto del 12/11)",
      candidato: "la foto de producción tras el deploy",
      ruido: "—",
    },
  ];
}

export function renderTable(rows: readonly TableRow[], o: { readonly base: string; readonly candidato: string }): string {
  const cell = (s: string) => s.replace(/\|/g, "\\|");
  return [
    `| Fila | Base (${o.base}) | Candidato (${o.candidato}) | ± |`,
    "|---|---|---|---|",
    ...rows.map((r) => `| ${cell(r.fila)} | ${cell(r.base)} | ${cell(r.candidato)} | ${cell(r.ruido)} |`),
    "",
    "**Lo que esta tabla NO cubre** (spec §4): apps, juegos, subagentes, herramientas, el asistente propio, los conectores " +
      "y el teléfono; y con ~3 turnos al día, producción no puede confirmar nada por sí sola. El juez («cumple lo pedido») " +
      "no vota hasta calibrarlo con las etiquetas de Jesús.",
  ].join("\n");
}
