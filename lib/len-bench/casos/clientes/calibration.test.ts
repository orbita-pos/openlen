// lib/len-bench/casos/clientes/calibration.test.ts
// @vitest-environment node
//
// CALIBRATING THE JUDGE (spec local 2026-11-12-len-3-1-ruta, §9 row 7): its verdicts on the calibration sheet,
// compared with the reference labels. It votes in the battery only if it agrees ~90 % and fails every sanity entry.
import { describe, expect, it } from "vitest";

import { promptDelJuez, VOTOS_DEL_JUEZ } from "../../juez";
import { agreement, CALIBRATION_BAR, estimateCalibrationUsd } from "./calibration";
import type { FetchedCase } from "./fetched";
import { sheetEntries, SANITY_ENTRIES } from "./judge-sheet";
import { CUMPLE_LO_PEDIDO } from "./rubric";

const caso = (i: number): FetchedCase => ({
  projectId: `00000000-0000-4000-8000-0000000000${(10 + i).toString(16)}`,
  fetchedAt: "t",
  start: { html: "" },
  final: { html: `<body><h1>Página ${i}</h1></body>` },
  ownerMessages: [`pedido ${i}`],
  cardAnswers: [],
  published: null,
});

describe("sheetEntries — what the sheet shows and what the judge is asked are the same", () => {
  it("up to 15 cases, then the sanity entries, each with the judge's view", async () => {
    const e = await sheetEntries(Array.from({ length: 20 }, (_, i) => caso(i)), async (d) => `pintado ${d.html?.length ?? 0}`);
    expect(e).toHaveLength(15 + SANITY_ENTRIES.length);
    expect(e[0]).toMatchObject({ caso: "cliente-00000000", cordura: false });
    expect(e[0]!.view).toContain("1. pedido 0");
    // What the painter returned is the page the judge reads.
    expect(e[0]!.view).toContain(`pintado ${caso(0).final.html!.length}`);
    expect(e.at(-1)).toMatchObject({ caso: "cordura-otra-peticion", cordura: true });
  });
});

describe("agreement", () => {
  const labels = [
    { caso: "cliente-aaaaaaaa", etiqueta: "PASS" as const },
    { caso: "cliente-bbbbbbbb", etiqueta: "FAIL" as const },
    { caso: "cliente-cccccccc", etiqueta: "PASS" as const },
    { caso: "pagina-vacia", etiqueta: "FAIL" as const },
  ];
  it("counts agreement on the real cases only; the sanity entries must each be FAIL", () => {
    const r = agreement(labels, [
      { caso: "cliente-aaaaaaaa", paso: true },
      { caso: "cliente-bbbbbbbb", paso: true },
      { caso: "cliente-cccccccc", paso: true },
      { caso: "cordura-pagina-vacia", paso: false },
    ]);
    expect(r.acuerdo).toBe(2);
    expect(r.total).toBe(3);
    expect(r.pct).toBeCloseTo(200 / 3, 9);
    expect(r.desacuerdos).toEqual([{ caso: "cliente-bbbbbbbb", etiqueta: "FAIL", juez: "PASS" }]);
    expect(r.cordura).toEqual([{ caso: "cordura-pagina-vacia", juez: "FAIL", ok: true }]);
    // 66.7 % is below the bar: the judge does not vote.
    expect(r.vota).toBe(false);
  });
  it("votes from the bar up, and only if every sanity entry failed", () => {
    expect(CALIBRATION_BAR).toBe(90);
    const todos = [
      { caso: "cliente-aaaaaaaa", paso: true },
      { caso: "cliente-bbbbbbbb", paso: false },
      { caso: "cliente-cccccccc", paso: true },
    ];
    expect(agreement(labels, [...todos, { caso: "cordura-pagina-vacia", paso: false }]).vota).toBe(true);
    expect(agreement(labels, [...todos, { caso: "cordura-pagina-vacia", paso: true }]).vota).toBe(false);
  });
  // A sheet that is mostly PASS rewards a judge that always says PASS: how many of the cases labelled FAIL it also
  // failed is said apart (the sanity entries are not cases: they are counted in `cordura`).
  it("says how many of the cases labelled FAIL the judge also failed", () => {
    const r = agreement(labels, [
      { caso: "cliente-aaaaaaaa", paso: true },
      { caso: "cliente-bbbbbbbb", paso: true },
      { caso: "cliente-cccccccc", paso: false },
      { caso: "cordura-pagina-vacia", paso: false },
    ]);
    expect(r.fallosAtrapados).toEqual({ atrapados: 0, total: 1 });
    expect(agreement(labels, [{ caso: "cliente-bbbbbbbb", paso: false }]).fallosAtrapados).toEqual({ atrapados: 1, total: 1 });
  });
  it("a verdict without a label is a mistake in the inputs, said by id", () => {
    expect(() => agreement(labels, [{ caso: "cliente-zzzzzzzz", paso: true }])).toThrow(/cliente-zzzzzzzz/);
  });
});

// What Jesús is shown before he says yes to the paid run: an estimate that errs UP (3 characters a token, where
// Spanish runs ~4), the judge's three votes, and its 16 output tokens each.
describe("estimateCalibrationUsd", () => {
  const rate = { input: 0.113, cached: 0.0141, output: 0.382 };
  const entry = (view: string) => ({ caso: "cliente-aaaaaaaa", cordura: false, view });
  it("three votes per entry, each the whole judge's prompt in and 16 tokens out", () => {
    const view = "x".repeat(3000);
    const tokensIn = Math.ceil(promptDelJuez(CUMPLE_LO_PEDIDO, "pedidos_y_pagina", view).length / 3) + 100;
    expect(estimateCalibrationUsd([entry(view)], rate)).toBeCloseTo((VOTOS_DEL_JUEZ * (tokensIn * 0.113 + 16 * 0.382)) / 1e6, 12);
  });
  it("adds up every entry", () => {
    const one = estimateCalibrationUsd([entry("a")], rate);
    expect(estimateCalibrationUsd([entry("a"), entry("a")], rate)).toBeCloseTo(2 * one, 12);
  });
});
