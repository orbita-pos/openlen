import { createHash } from "node:crypto";

import type { GenerationRoute } from "./contracts";

export interface SelectorEvalRow {
  caseId: string;
  intentOk: boolean;
  observedDomains: string[];
  observedAudience: string | null;
  observedForbiddenSignals: string[];
  domainRecall: number;
  audienceMatch: boolean;
  forbiddenSignalRecall: number;
  route: GenerationRoute | null;
  templateId: string | null;
  selectedTemplateForbiddenSignals: string[];
  durationMs: number;
  errorKind: string | null;
}

export interface SelectorEvalSummary {
  cases: number;
  intentOk: number;
  intentSuccess: number;
  domainRecall: number;
  audienceAccuracy: number;
  forbiddenSignalRecall: number;
  forbiddenTemplateSelections: number;
}

export const SELECTOR_GATE = Object.freeze({
  intentSuccess: 0.95,
  domainRecall: 0.90,
  audienceAccuracy: 0.90,
  forbiddenSignalRecall: 0.85,
  forbiddenTemplateSelections: 0,
});

export const HOLDOUT_GATE = Object.freeze({
  intentSuccess: 0.90,
  domainRecall: 0.90,
  audienceAccuracy: 0.90,
  diagnosticSignalCompliance: 0.90,
  forbiddenTemplateSelections: 0,
});

export type SelectorGateFailure =
  | "caseCount"
  | keyof typeof SELECTOR_GATE;

export interface HoldoutEvalSummary extends SelectorEvalSummary {
  diagnosticSignalCompliance: number;
}

export type HoldoutGateFailure = "caseCount" | keyof typeof HOLDOUT_GATE;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${entries.join(",")}}`;
}

export function stableJsonHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function ratio(found: number, total: number): number {
  return total === 0 ? 0 : found / total;
}

function average(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function summarizeSelectorEval(
  rows: readonly SelectorEvalRow[],
): SelectorEvalSummary {
  const intentOk = rows.filter((row) => row.intentOk).length;
  return {
    cases: rows.length,
    intentOk,
    intentSuccess: ratio(intentOk, rows.length),
    domainRecall: average(rows.map((row) => row.domainRecall)),
    audienceAccuracy: ratio(
      rows.filter((row) => row.audienceMatch).length,
      rows.length,
    ),
    forbiddenSignalRecall: average(
      rows.map((row) => row.forbiddenSignalRecall),
    ),
    forbiddenTemplateSelections: rows.filter((row) =>
      row.route === "template_full"
      && row.selectedTemplateForbiddenSignals.length > 0).length,
  };
}

export function summarizeHoldoutEval(
  rows: readonly SelectorEvalRow[],
  canonicalSignals: readonly string[],
): HoldoutEvalSummary {
  const summary = summarizeSelectorEval(rows);
  const allowed = new Set(canonicalSignals);
  const compliant = rows.filter((row) =>
    row.intentOk
    && row.observedForbiddenSignals.length >= 2
    && row.observedForbiddenSignals.length <= 4
    && row.observedForbiddenSignals.every((signal) => allowed.has(signal))).length;
  return {
    ...summary,
    diagnosticSignalCompliance: ratio(compliant, rows.length),
  };
}

export function selectorGateFailures(
  summary: SelectorEvalSummary,
  expectedCases: number,
): SelectorGateFailure[] {
  const failures: SelectorGateFailure[] = [];
  if (summary.cases !== expectedCases) failures.push("caseCount");
  if (summary.intentSuccess < SELECTOR_GATE.intentSuccess) failures.push("intentSuccess");
  if (summary.domainRecall < SELECTOR_GATE.domainRecall) failures.push("domainRecall");
  if (summary.audienceAccuracy < SELECTOR_GATE.audienceAccuracy) {
    failures.push("audienceAccuracy");
  }
  if (summary.forbiddenSignalRecall < SELECTOR_GATE.forbiddenSignalRecall) {
    failures.push("forbiddenSignalRecall");
  }
  if (summary.forbiddenTemplateSelections !== SELECTOR_GATE.forbiddenTemplateSelections) {
    failures.push("forbiddenTemplateSelections");
  }
  return failures;
}

export function passesSelectorGate(
  summary: SelectorEvalSummary,
  expectedCases: number,
): boolean {
  return selectorGateFailures(summary, expectedCases).length === 0;
}

export function holdoutGateFailures(
  summary: HoldoutEvalSummary,
  expectedCases: number,
): HoldoutGateFailure[] {
  const failures: HoldoutGateFailure[] = [];
  if (summary.cases !== expectedCases) failures.push("caseCount");
  if (summary.intentSuccess < HOLDOUT_GATE.intentSuccess) failures.push("intentSuccess");
  if (summary.domainRecall < HOLDOUT_GATE.domainRecall) failures.push("domainRecall");
  if (summary.audienceAccuracy < HOLDOUT_GATE.audienceAccuracy) {
    failures.push("audienceAccuracy");
  }
  if (summary.diagnosticSignalCompliance < HOLDOUT_GATE.diagnosticSignalCompliance) {
    failures.push("diagnosticSignalCompliance");
  }
  if (summary.forbiddenTemplateSelections !== HOLDOUT_GATE.forbiddenTemplateSelections) {
    failures.push("forbiddenTemplateSelections");
  }
  return failures;
}

export function passesHoldoutGate(
  summary: HoldoutEvalSummary,
  expectedCases: number,
): boolean {
  return holdoutGateFailures(summary, expectedCases).length === 0;
}
