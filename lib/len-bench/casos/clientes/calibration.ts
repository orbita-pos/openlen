// lib/len-bench/casos/clientes/calibration.ts — CALIBRATING THE JUDGE of Len 3.1's battery 1.
//
// Spec local 2026-11-12-len-3-1-ruta, §9 row 7 (Anthropic's eval health checklist): the judge votes only if it
// agrees with reference labels (~90 %) and fails the three sanity entries. The labels are a reference judgment of
// the same sheet (judge-sheet.ts) — a person's, or, decided by Jesús on 15/11, a stronger model's of another family
// labelling blind, with Jesús checking a few. The judge is asked exactly as in a run (juez.ts, `judgeVerdict`).
import type { TarifaPorMillon } from "@/lib/ai/tarifas-eval";
import { promptDelJuez, VOTOS_DEL_JUEZ } from "../../juez";
import type { SheetEntry } from "./judge-sheet";
import { CUMPLE_LO_PEDIDO } from "./rubric";

/** The agreement from which the judge votes: Anthropic's «~90 %». */
export const CALIBRATION_BAR = 90;

/** What asking the judge about every entry costs, erring UP: 3 characters a token (Spanish runs ~4) plus 100 for
 *  the system line, three votes, 16 tokens out each (the judge's `maxOutputTokens`). Shown before the paid run. */
export function estimateCalibrationUsd(entries: readonly SheetEntry[], rate: TarifaPorMillon): number {
  let usd = 0;
  for (const e of entries) {
    const tokensIn = Math.ceil(promptDelJuez(CUMPLE_LO_PEDIDO, "pedidos_y_pagina", e.view).length / 3) + 100;
    usd += (VOTOS_DEL_JUEZ * (tokensIn * rate.input + 16 * rate.output)) / 1e6;
  }
  return usd;
}

export interface ReferenceLabel {
  /** `cliente-<8 hex>`, or a sanity entry by its name (with or without `cordura-`). */
  readonly caso: string;
  readonly etiqueta: "PASS" | "FAIL";
}

export interface JudgeOnEntry {
  readonly caso: string;
  readonly paso: boolean;
}

const key = (caso: string) => caso.replace(/^cordura-/, "");
const word = (paso: boolean) => (paso ? "PASS" : "FAIL");

export function agreement(labels: readonly ReferenceLabel[], verdicts: readonly JudgeOnEntry[]): {
  acuerdo: number;
  total: number;
  pct: number;
  desacuerdos: { caso: string; etiqueta: "PASS" | "FAIL"; juez: "PASS" | "FAIL" }[];
  cordura: { caso: string; juez: "PASS" | "FAIL"; ok: boolean }[];
  vota: boolean;
} {
  const byKey = new Map(labels.map((l) => [key(l.caso), l]));
  let acuerdo = 0;
  let total = 0;
  const desacuerdos: { caso: string; etiqueta: "PASS" | "FAIL"; juez: "PASS" | "FAIL" }[] = [];
  const cordura: { caso: string; juez: "PASS" | "FAIL"; ok: boolean }[] = [];
  for (const v of verdicts) {
    if (v.caso.startsWith("cordura-")) {
      cordura.push({ caso: v.caso, juez: word(v.paso), ok: !v.paso });
      continue;
    }
    const label = byKey.get(key(v.caso));
    if (!label) throw new Error(`el juez juzgó ${v.caso} y no hay etiqueta para ese caso`);
    total++;
    if ((label.etiqueta === "PASS") === v.paso) acuerdo++;
    else desacuerdos.push({ caso: v.caso, etiqueta: label.etiqueta, juez: word(v.paso) });
  }
  const pct = total === 0 ? 0 : (100 * acuerdo) / total;
  return { acuerdo, total, pct, desacuerdos, cordura, vota: total > 0 && pct >= CALIBRATION_BAR && cordura.every((c) => c.ok) };
}
