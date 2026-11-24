// lib/len-bench/evaluator-fingerprint.test.ts
// @vitest-environment node
//
// THE EVALUATOR'S FINGERPRINT (spec local 2026-11-12-len-3-1-ruta, §5 piece 5): the two columns of the 3.1
// table are only comparable if they were graded by the same evaluator. Claude Code's harness integrity gate
// only detects changes and is no security boundary, and an unattended run never passes its approval
// (§3.1).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { EVALUATOR_SOURCES, evaluatorFingerprint, evaluatorPartsOf, fingerprintProblem, readEvaluatorFile, writeEvaluatorFile, type EvaluatorParts } from "./evaluator-fingerprint";
import type { Encargo, Grader } from "./tipos";

describe("evaluatorPartsOf — the evaluator of a suite, from its cases", () => {
  const grader = (nombre: string, extra: Partial<Grader> = {}): Grader => ({ nombre, peso: 2, calificar: async () => ({ paso: true, explicacion: "" }), ...extra });
  const encargo = (id: string, graders: Grader[]) => ({ id, graders }) as unknown as Encargo;
  it("names each grader with its case, so the same grader in two cases counts twice", () => {
    const p = evaluatorPartsOf([encargo("a", [grader("nada-inventado")]), encargo("b", [grader("nada-inventado", { puntua: false, criterio: "c", foco: "traza" })])], { model: "m", prompt: "p", votes: 3 }, ["src"]);
    expect(p.caseIds).toEqual(["a", "b"]);
    expect(p.graders).toEqual([
      { nombre: "a/nada-inventado", peso: 2, puntua: true },
      { nombre: "b/nada-inventado", peso: 2, puntua: false, criterio: "c", foco: "traza" },
    ]);
    expect(p).toMatchObject({ judgeModel: "m", judgePrompt: "p", votes: 3, sources: ["src"] });
  });
});

describe("the fingerprint covers what each case IS, not only its id (review I7)", () => {
  const judge = { model: "m", prompt: "p", votes: 3 };
  const caso = (mensaje: string, extra: Partial<Encargo> = {}) =>
    ({ id: "cliente-aaaa1111", graders: [], inicio: { html: "" }, ficha: { negocio: "x", datos: { subdominio: "a" } }, guion: [{ tipo: "pide", mensaje }], ...extra }) as unknown as Encargo;
  it("a re-fetched case with the same id and another message is another evaluator", () => {
    expect(evaluatorFingerprint(evaluatorPartsOf([caso("haz mi página")], judge, []))).not.toBe(evaluatorFingerprint(evaluatorPartsOf([caso("haz mi página, con fotos")], judge, [])));
  });
  it("so is another ficha, or another starting page", () => {
    const base = evaluatorFingerprint(evaluatorPartsOf([caso("x")], judge, []));
    expect(evaluatorFingerprint(evaluatorPartsOf([caso("x", { ficha: { negocio: "x", datos: { subdominio: "b" } } })], judge, []))).not.toBe(base);
    expect(evaluatorFingerprint(evaluatorPartsOf([caso("x", { inicio: { html: "<p>hola</p>" } })], judge, []))).not.toBe(base);
  });
  it("the simulated owner and the conductor are part of the evaluator's code", () => {
    expect(EVALUATOR_SOURCES).toEqual(expect.arrayContaining(["lib/len-bench/cliente-simulado.ts", "lib/len-bench/sesion.ts", "lib/len-bench/conductor.ts"]));
  });
});

describe("the fingerprint on disk (evaluador.json)", () => {
  it("is written when a column starts and read back by the next", () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lb-ev-")), "columna");
    writeEvaluatorFile(dir, { huella: "0123456789abcdef", judgeModel: "m", cases: 2 });
    expect(readEvaluatorFile(dir)).toBe("0123456789abcdef");
  });
  it("a folder without it has none", () => {
    expect(readEvaluatorFile(fs.mkdtempSync(path.join(os.tmpdir(), "lb-ev-")))).toBeUndefined();
  });
});

const parts = (o: Partial<EvaluatorParts> = {}): EvaluatorParts => ({
  caseIds: ["cliente-aaaa1111", "cliente-bbbb2222"],
  graders: [
    { nombre: "nada-inventado", peso: 3, puntua: true },
    { nombre: "cumple-lo-pedido", peso: 1, puntua: false, criterio: "Cada cosa pedida está hecha.", foco: "pedidos_y_pagina" },
  ],
  judgeModel: "Qwen/Qwen3.8-Flash",
  judgePrompt: "Calificas la salida de un agente contra un criterio.",
  votes: 3,
  sources: ["// graders.ts v1"],
  ...o,
});

describe("evaluatorFingerprint", () => {
  it("is 16 hex characters and the same for the same evaluator", () => {
    expect(evaluatorFingerprint(parts())).toMatch(/^[0-9a-f]{16}$/);
    expect(evaluatorFingerprint(parts())).toBe(evaluatorFingerprint(parts()));
  });

  it("does not change when only the ORDER of the cases changes", () => {
    expect(evaluatorFingerprint(parts({ caseIds: ["cliente-bbbb2222", "cliente-aaaa1111"] }))).toBe(evaluatorFingerprint(parts()));
  });

  it("changes with the judge's criterion, its focus, its model, its prompt or its votes", () => {
    const base = evaluatorFingerprint(parts());
    const judge = parts().graders[1]!;
    expect(evaluatorFingerprint(parts({ graders: [parts().graders[0]!, { ...judge, criterio: "Otra cosa." }] }))).not.toBe(base);
    expect(evaluatorFingerprint(parts({ graders: [parts().graders[0]!, { ...judge, foco: "traza" }] }))).not.toBe(base);
    expect(evaluatorFingerprint(parts({ judgeModel: "XiaomiMiMo/MiMo-V2.6-Flash" }))).not.toBe(base);
    expect(evaluatorFingerprint(parts({ judgePrompt: "Otro prompt." }))).not.toBe(base);
    expect(evaluatorFingerprint(parts({ votes: 5 }))).not.toBe(base);
  });

  it("changes with a grader's weight, whether it votes, the list of cases, or the graders' code", () => {
    const base = evaluatorFingerprint(parts());
    expect(evaluatorFingerprint(parts({ graders: [{ nombre: "nada-inventado", peso: 2, puntua: true }, parts().graders[1]!] }))).not.toBe(base);
    expect(evaluatorFingerprint(parts({ graders: [{ nombre: "nada-inventado", peso: 3, puntua: false }, parts().graders[1]!] }))).not.toBe(base);
    expect(evaluatorFingerprint(parts({ caseIds: ["cliente-aaaa1111"] }))).not.toBe(base);
    expect(evaluatorFingerprint(parts({ sources: ["// graders.ts v2"] }))).not.toBe(base);
  });
});

describe("fingerprintProblem — a column graded by another evaluator is refused", () => {
  it("nothing to compare against: fine", () => {
    expect(fingerprintProblem({ actual: "a".repeat(16), approved: false })).toBeNull();
  });
  it("the same fingerprint: fine", () => {
    expect(fingerprintProblem({ expected: "a".repeat(16), actual: "a".repeat(16), approved: false })).toBeNull();
  });
  it("another fingerprint: refused, saying how to approve it on purpose", () => {
    expect(fingerprintProblem({ expected: "a".repeat(16), actual: "b".repeat(16), approved: false })).toMatch(/--aprobar-evaluador/);
  });
  it("another fingerprint, approved by a person: fine", () => {
    expect(fingerprintProblem({ expected: "a".repeat(16), actual: "b".repeat(16), approved: true })).toBeNull();
  });
});
