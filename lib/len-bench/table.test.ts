// lib/len-bench/table.test.ts
// @vitest-environment node
//
// THE LEN 3.1 TABLE (spec local 2026-11-12-len-3-1-ruta, §4; plan local 2026-11-15, task 11): one row per thing
// measured, the base column (92f4f7e21) and the candidate side by side, with the noise of each row written next
// to it. No threshold: a row that does not leave the noise says so.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { saveRun } from "./run-store";
import { allRuns, columnOf, renderTable, tableRows } from "./table";
import type { ResultadoDeCorrida } from "./tipos";

const corrida = (o: Partial<ResultadoDeCorrida> = {}): ResultadoDeCorrida => ({
  graders: [],
  score: 1,
  desenlace: "completa",
  turnosDeLen: 2,
  creditos: 1,
  usd: 0.04,
  segundos: 300,
  pasos: 20,
  sub: "lb-x",
  publishRechazados: 0,
  cacheLeida: 0.9,
  noLeidos: 0,
  repeticiones: 0,
  ...o,
});

function column(runs: [string, number, Partial<ResultadoDeCorrida>][]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-col-"));
  for (const [caseId, run, o] of runs) saveRun(dir, caseId, run, corrida(o));
  return dir;
}

describe("allRuns", () => {
  it("reads every run of a column, the harness's included, with its case and number", () => {
    const dir = column([["cliente-aaaa1111", 1, {}], ["cliente-aaaa1111", 2, { desenlace: "proveedor", score: 0 }]]);
    expect(allRuns(dir).map((r) => [r.caseId, r.run, r.result.desenlace])).toEqual([
      ["cliente-aaaa1111", 1, "completa"],
      ["cliente-aaaa1111", 2, "proveedor"],
    ]);
  });
});

describe("tableRows", () => {
  const base = columnOf(allRuns(column([
    ["c-1", 1, { score: 1, usd: 0.02, pasos: 10, segundos: 120 }],
    ["c-1", 2, { score: 0.5, usd: 0.04, pasos: 20, segundos: 240, publishRechazados: 1, noLeidos: 2 }],
    ["c-2", 1, { score: 1, usd: 0.06, pasos: 30, segundos: 360, repeticiones: 1 }],
    ["c-2", 2, { desenlace: "proveedor", score: 0 }],
  ])));
  const candidate = columnOf(allRuns(column([
    ["c-1", 1, { score: 1, usd: 0.01, pasos: 8, segundos: 60 }],
    ["c-1", 2, { score: 1, usd: 0.01, pasos: 8, segundos: 60 }],
    ["c-2", 1, { desenlace: "error_de_len", score: 0, usd: 0.03 }],
    ["c-2", 2, { score: 1, usd: 0.02, pasos: 12, segundos: 90 }],
  ])));
  const rows = tableRows(base, candidate, { publishingCases: new Set(["c-1"]) });
  const row = (name: string) => rows.find((r) => r.fila.startsWith(name))!;

  it("finished tasks: the share of Len's runs with every voting grader passed; the harness's are left out", () => {
    expect(row("Encargos terminados").base).toBe("2 de 3 (66,7 %)");
    expect(row("Encargos terminados").candidato).toBe("3 de 4 (75,0 %)");
    // ± from the spec's formula on the base column: 100 / √3.
    expect(row("Encargos terminados").ruido).toBe("±57,7 pts");
  });

  // REVIEW I2 (15/11): a run that never published counted as «publica sin rechazo», and so did one where nothing was
  // measured. Now: publishes = len-publico passed; with no rejected publish; unmeasured runs said apart.
  it("F2: among the runs of cases where Len published, those that DID publish with no rejected publish; unmeasured apart", () => {
    const lp = (paso: boolean) => [{ nombre: "len-publico", paso, peso: 2, puntua: true, explicacion: "" }];
    const b = columnOf(allRuns(column([
      ["c-1", 1, { publishRechazados: 0, graders: lp(true) }],
      ["c-1", 2, { publishRechazados: 1, graders: lp(true) }],
      ["c-1", 3, { publishRechazados: 0, graders: lp(false) }],
      ["c-1", 4, { desenlace: "error_de_len", score: 0, publishRechazados: undefined, graders: [] }],
    ])));
    const r = tableRows(b, b, { publishingCases: new Set(["c-1"]) }).find((x) => x.fila.startsWith("Publica sin rechazo"))!;
    expect(r.base).toBe("1 de 3 (33,3 %) · 1 sin medir");
  });

  it("cost, calls and minutes per task as mean · p50 · p90, over Len's runs", () => {
    expect(row("Coste por encargo").base).toBe("$0,0400 · $0,0400 · $0,0560");
    expect(row("Llamadas al modelo").base).toBe("20 · 20 · 28");
    expect(row("Minutos por encargo").base).toBe("4,0 · 4,0 · 5,6");
  });

  it("F3 and F4 as counts per task; unfinished turns with the harness's apart", () => {
    expect(row("Escrituras sin leer").base).toBe("0,67 por encargo");
    expect(row("Bucles").base).toBe("1 de 3 corridas");
    expect(row("Turnos que no terminan").base).toBe("0 de Len · 1 del arnés");
    expect(row("Turnos que no terminan").candidato).toBe("1 de Len · 0 del arnés");
  });

  it("renders as markdown with what the table does not cover underneath", () => {
    const md = renderTable(rows, { base: "92f4f7e21", candidato: "24b478a4c" });
    expect(md).toMatch(/^\| Fila \| Base \(92f4f7e21\) \| Candidato \(24b478a4c\) \| ± \|/m);
    expect(md).toMatch(/Lo que esta tabla NO cubre/);
    expect(md).toMatch(/apps, juegos, subagentes/);
  });
});
