// lib/len-bench/run-store.test.ts
// @vitest-environment node
//
// A SUITE THAT RESUMES BY (CASE, RUN) (spec local 2026-11-12-len-3-1-ruta, §5 piece 5, the shape of Claude
// Code's runner scaffold): each run is kept as it ends, a resumed suite skips the runs Len finished and runs
// again those the harness could not measure.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { estimateFromPilot, infraFailures, keptRuns, recordSpend, runKey, runsDirProblem, saveRun, spentSoFar } from "./run-store";

describe("the spend of a column survives a resume (review I1)", () => {
  it("a column that resumes keeps counting from what it already spent — infra failures included", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-spend-"));
    expect(spentSoFar(dir)).toBe(0);
    recordSpend(dir, 0.03);
    recordSpend(dir, 0.05);
    expect(spentSoFar(dir)).toBeCloseTo(0.08, 12);
  });
  it("a negative or non-finite amount is never recorded as spent", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-spend-"));
    recordSpend(dir, Number.NaN);
    recordSpend(dir, -1);
    expect(spentSoFar(dir)).toBe(0);
  });
});
import { resumirCaso } from "./puntuar";
import type { ResultadoDeCorrida } from "./tipos";

const corrida = (desenlace: ResultadoDeCorrida["desenlace"], score = 1, error?: string): ResultadoDeCorrida => ({
  graders: [],
  score,
  desenlace,
  ...(error ? { error } : {}),
  turnosDeLen: 2,
  creditos: 1.5,
  usd: 0.03,
  segundos: 120,
  sub: "lb-x",
  proveedores: ["deepinfra"],
});

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "lb-runs-"));

describe("saveRun / keptRuns", () => {
  it("a kept run reads back exactly as it was written", () => {
    const dir = tmp();
    saveRun(dir, "cliente-ab12cd34", 1, corrida("completa", 0.5));
    expect(fs.existsSync(path.join(dir, "runs", "cliente-ab12cd34-1.json"))).toBe(true);
    expect(keptRuns(dir).get(runKey("cliente-ab12cd34", 1))).toEqual(corrida("completa", 0.5));
  });

  it("keeps what Len finished, and leaves out what the harness could not measure so it runs again", () => {
    const dir = tmp();
    saveRun(dir, "c-1", 1, corrida("completa"));
    saveRun(dir, "c-1", 2, corrida("error_de_len", 0, "boom"));
    saveRun(dir, "c-1", 3, corrida("proveedor", 0, "upstream"));
    const kept = keptRuns(dir);
    expect([...kept.keys()].sort()).toEqual([runKey("c-1", 1), runKey("c-1", 2)]);
  });

  it("a case id with hyphens and a two-digit run are told apart", () => {
    const dir = tmp();
    saveRun(dir, "a-b-c", 12, corrida("completa"));
    expect(keptRuns(dir).has(runKey("a-b-c", 12))).toBe(true);
  });

  it("no folder yet: nothing kept", () => {
    expect(keptRuns(path.join(tmp(), "nada")).size).toBe(0);
  });
});

describe("infraFailures", () => {
  it("lists the runs the harness could not measure, with their case, run and error", () => {
    const casos = [resumirCaso("c-1", "N2", [corrida("completa"), corrida("proveedor", 0, "upstream: 0 tokens")])];
    expect(infraFailures(casos)).toEqual([{ caseId: "c-1", run: 2, desenlace: "proveedor", error: "upstream: 0 tokens" }]);
  });
});

describe("runsDirProblem — two suites never share a folder by accident", () => {
  it("a folder that already holds runs is refused unless the suite resumes it", () => {
    const dir = tmp();
    saveRun(dir, "c-1", 1, corrida("completa"));
    expect(runsDirProblem(dir, false)).toMatch(/--reanudar/);
    expect(runsDirProblem(dir, true)).toBeNull();
  });
  it("a new folder is fine; resuming a folder with no runs is refused (a typo would start from zero)", () => {
    const dir = path.join(tmp(), "nueva");
    expect(runsDirProblem(dir, false)).toBeNull();
    expect(runsDirProblem(dir, true)).toMatch(/no hay corridas/);
  });
});

describe("estimateFromPilot — the cost of a case run comes from the pilot, not from a constant", () => {
  it("is the mean of the runs Len finished; the harness's are left out", () => {
    const dir = tmp();
    const runAt = (usd: number, desenlace: ResultadoDeCorrida["desenlace"] = "completa") => ({ ...corrida(desenlace), usd });
    saveRun(dir, "c-1", 1, runAt(0.02));
    saveRun(dir, "c-2", 1, runAt(0.06));
    saveRun(dir, "c-3", 1, runAt(0.04, "error_de_len"));
    saveRun(dir, "c-4", 1, runAt(9, "proveedor"));
    const e = estimateFromPilot(dir);
    expect(e.runs).toBe(3);
    expect(e.usdPerCaseRun).toBeCloseTo(0.04, 12);
  });
  it("a pilot with no runs is not an estimate", () => {
    expect(() => estimateFromPilot(tmp())).toThrow(/piloto/);
  });
});
