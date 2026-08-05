import { describe, expect, it } from "vitest";

import {
  SELECTOR_GATE,
  HOLDOUT_GATE,
  holdoutGateFailures,
  passesHoldoutGate,
  passesSelectorGate,
  selectorGateFailures,
  stableJsonHash,
  summarizeSelectorEval,
  summarizeHoldoutEval,
  type SelectorEvalRow,
  type SelectorEvalSummary,
} from "./selector-scorecard";

function row(patch: Partial<SelectorEvalRow> = {}): SelectorEvalRow {
  return {
    caseId: "case",
    intentOk: true,
    observedDomains: ["education"],
    observedAudience: "adults",
    observedForbiddenSignals: ["children_toy_ui"],
    domainRecall: 1,
    audienceMatch: true,
    forbiddenSignalRecall: 1,
    route: "template_full",
    templateId: "template",
    selectedTemplateForbiddenSignals: [],
    durationMs: 10,
    errorKind: null,
    ...patch,
  };
}

describe("selector scorecard", () => {
  it("keeps model failures in every denominator", () => {
    const summary = summarizeSelectorEval([
      row(),
      row({
        caseId: "failed",
        intentOk: false,
        domainRecall: 0,
        audienceMatch: false,
        forbiddenSignalRecall: 0,
        route: null,
        templateId: null,
        errorKind: "timeout",
      }),
    ]);

    expect(summary).toEqual({
      cases: 2,
      intentOk: 1,
      intentSuccess: 0.5,
      domainRecall: 0.5,
      audienceAccuracy: 0.5,
      forbiddenSignalRecall: 0.5,
      forbiddenTemplateSelections: 0,
    });
  });

  it("counts forbidden signals only on selected whole templates", () => {
    const summary = summarizeSelectorEval([
      row({ selectedTemplateForbiddenSignals: ["saas_dashboard"] }),
      row({
        caseId: "skeleton",
        route: "template_skeleton",
        selectedTemplateForbiddenSignals: ["course_progress_ui"],
      }),
    ]);

    expect(summary.forbiddenTemplateSelections).toBe(1);
  });

  it("uses the exact inclusive Phase 1 thresholds", () => {
    const atGate: SelectorEvalSummary = {
      cases: 20,
      intentOk: 19,
      intentSuccess: 0.95,
      domainRecall: 0.9,
      audienceAccuracy: 0.9,
      forbiddenSignalRecall: 0.85,
      forbiddenTemplateSelections: 0,
    };

    expect(SELECTOR_GATE).toEqual({
      intentSuccess: 0.95,
      domainRecall: 0.9,
      audienceAccuracy: 0.9,
      forbiddenSignalRecall: 0.85,
      forbiddenTemplateSelections: 0,
    });
    expect(selectorGateFailures(atGate, 20)).toEqual([]);
    expect(passesSelectorGate(atGate, 20)).toBe(true);
  });

  it.each([
    ["intentSuccess", 0.949],
    ["domainRecall", 0.899],
    ["audienceAccuracy", 0.899],
    ["forbiddenSignalRecall", 0.849],
    ["forbiddenTemplateSelections", 1],
  ] as const)("fails when %s misses its gate", (metric, value) => {
    const summary: SelectorEvalSummary = {
      cases: 20,
      intentOk: 20,
      intentSuccess: 1,
      domainRecall: 1,
      audienceAccuracy: 1,
      forbiddenSignalRecall: 1,
      forbiddenTemplateSelections: 0,
      [metric]: value,
    };

    expect(passesSelectorGate(summary, 20)).toBe(false);
    expect(selectorGateFailures(summary, 20)).toContain(metric);
  });

  it("fails a truncated or empty corpus even when aggregate metrics look perfect", () => {
    const summary = summarizeSelectorEval([row()]);

    expect(passesSelectorGate(summary, 20)).toBe(false);
    expect(selectorGateFailures(summary, 20)).toContain("caseCount");
  });

  it("fingerprints JSON canonically regardless of object key insertion order", () => {
    const first = stableJsonHash({ b: 2, a: { d: 4, c: 3 } });
    const second = stableJsonHash({ a: { c: 3, d: 4 }, b: 2 });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toBe(first);
    expect(stableJsonHash({ a: 2 })).not.toBe(stableJsonHash({ a: 1 }));
  });

  it("gates held-out generalization without claiming one subjective contrast is unique", () => {
    const canonicalSignals = [
      "children_toy_ui",
      "gaming_esports",
      "developer_terminal",
    ];
    const rows = Array.from({ length: 10 }, (_, index) => row({
      caseId: `holdout-${index}`,
      observedForbiddenSignals: index === 0
        ? []
        : ["children_toy_ui", "gaming_esports"],
      intentOk: index !== 0,
      domainRecall: index === 0 ? 0 : 1,
      audienceMatch: index !== 0,
      route: index === 0 ? null : "section_composition",
      templateId: null,
      errorKind: index === 0 ? "schema" : null,
    }));

    const summary = summarizeHoldoutEval(rows, canonicalSignals);

    expect(HOLDOUT_GATE).toEqual({
      intentSuccess: 0.9,
      domainRecall: 0.9,
      audienceAccuracy: 0.9,
      diagnosticSignalCompliance: 0.9,
      forbiddenTemplateSelections: 0,
    });
    expect(summary).toMatchObject({
      intentSuccess: 0.9,
      domainRecall: 0.9,
      audienceAccuracy: 0.9,
      diagnosticSignalCompliance: 0.9,
      forbiddenTemplateSelections: 0,
    });
    expect(holdoutGateFailures(summary, 10)).toEqual([]);
    expect(passesHoldoutGate(summary, 10)).toBe(true);
  });

  it("fails holdout when signals are non-canonical, blanket, or absent", () => {
    const summary = summarizeHoldoutEval([
      row({ observedForbiddenSignals: ["invented_signal", "gaming_esports"] }),
      row({
        caseId: "blanket",
        observedForbiddenSignals: ["a", "b", "c", "d", "e"],
      }),
    ], ["gaming_esports"]);

    expect(summary.diagnosticSignalCompliance).toBe(0);
    expect(passesHoldoutGate(summary, 2)).toBe(false);
    expect(holdoutGateFailures(summary, 2)).toContain("diagnosticSignalCompliance");
  });
});
