import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  analyzeIntent,
  CANONICAL_FORBIDDEN_VISUAL_SIGNALS,
  INTENT_PROMPT_VERSION,
} from "@/lib/generation/analyze-intent";
import {
  DECISION_POLICY_VERSION,
  decideGenerationRoute,
} from "@/lib/generation/decide-route";
import { SELECTOR_CASES } from "@/lib/generation/selector-cases";
import type { SelectorEvalCase } from "@/lib/generation/selector-cases";
import { SELECTOR_HOLDOUT_CASES } from "@/lib/generation/selector-holdout-cases";
import {
  passesSelectorGate,
  passesHoldoutGate,
  HOLDOUT_GATE,
  holdoutGateFailures,
  SELECTOR_GATE,
  selectorGateFailures,
  stableJsonHash,
  summarizeSelectorEval,
  summarizeHoldoutEval,
  type SelectorEvalRow,
} from "@/lib/generation/selector-scorecard";
import { rankTemplates } from "@/lib/generation/score-template";
import { TAXONOMY_COMPATIBILITY_VERSION } from "@/lib/generation/taxonomy-compatibility";
import { listTemplates } from "@/lib/templates/store";

const SELECTOR_EVAL_SCHEMA_VERSION = "selector-eval/1.0" as const;

function intersection(left: readonly string[], right: readonly string[]): string[] {
  const rightValues = new Set(right);
  return [...new Set(left)].filter((value) => rightValues.has(value));
}

function ratio(found: number, total: number): number {
  return total === 0 ? 1 : found / total;
}

function outputPath(args = process.argv): string {
  const index = args.indexOf("--out");
  const value = index >= 0 ? args[index + 1] : null;
  if (!value || value.startsWith("--")) throw new Error("--out is required");
  return resolve(value);
}

async function evaluateCases(
  cases: readonly SelectorEvalCase[],
  templates: Awaited<ReturnType<typeof listTemplates>>,
  modelIds: Set<string>,
): Promise<SelectorEvalRow[]> {
  const rows: SelectorEvalRow[] = [];
  for (const evalCase of cases) {
    const result = await analyzeIntent(evalCase.brief);
    modelIds.add(result.modelId);
    if (!result.ok) {
      rows.push({
        caseId: evalCase.id,
        intentOk: false,
        observedDomains: [],
        observedAudience: null,
        observedForbiddenSignals: [],
        domainRecall: 0,
        audienceMatch: false,
        forbiddenSignalRecall: 0,
        route: null,
        templateId: null,
        selectedTemplateForbiddenSignals: [],
        durationMs: result.durationMs,
        errorKind: result.error.kind,
      });
      continue;
    }

    const ranked = rankTemplates(result.intent, templates);
    const decision = decideGenerationRoute(ranked);
    const selected = decision.templateId
      ? templates.find((template) => template.id === decision.templateId) ?? null
      : null;
    rows.push({
      caseId: evalCase.id,
      intentOk: true,
      observedDomains: result.intent.domains,
      observedAudience: result.intent.audience.primary,
      observedForbiddenSignals: result.intent.forbiddenVisualSignals,
      domainRecall: ratio(
        intersection(evalCase.expectedDomains, result.intent.domains).length,
        evalCase.expectedDomains.length,
      ),
      audienceMatch: result.intent.audience.primary === evalCase.expectedAudience,
      forbiddenSignalRecall: ratio(
        intersection(evalCase.forbiddenSignals, result.intent.forbiddenVisualSignals).length,
        evalCase.forbiddenSignals.length,
      ),
      route: decision.route,
      templateId: decision.templateId,
      selectedTemplateForbiddenSignals: intersection(
        evalCase.forbiddenSignals,
        selected?.visualMetadata?.visualSignals ?? [],
      ),
      durationMs: result.durationMs,
      errorKind: null,
    });
  }
  return rows;
}

async function main(): Promise<void> {
  const templates = await listTemplates({ status: "published" });
  const modelIds = new Set<string>();
  const rows = await evaluateCases(SELECTOR_CASES, templates, modelIds);
  const holdoutRows = await evaluateCases(SELECTOR_HOLDOUT_CASES, templates, modelIds);

  const summary = summarizeSelectorEval(rows);
  const holdoutSummary = summarizeHoldoutEval(
    holdoutRows,
    CANONICAL_FORBIDDEN_VISUAL_SIGNALS,
  );
  const developmentFailures = selectorGateFailures(summary, SELECTOR_CASES.length);
  const holdoutFailures = holdoutGateFailures(
    holdoutSummary,
    SELECTOR_HOLDOUT_CASES.length,
  );
  const reviewedMetadata = templates.filter(
    (template) => template.visualMetadata?.reviewStatus === "reviewed",
  ).length;
  const report = {
    schemaVersion: SELECTOR_EVAL_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    versions: {
      prompt: INTENT_PROMPT_VERSION,
      policy: DECISION_POLICY_VERSION,
      taxonomy: TAXONOMY_COMPATIBILITY_VERSION,
    },
    modelIds: [...modelIds].sort(),
    provenance: {
      selectorCorpusSha256: stableJsonHash({
        development: SELECTOR_CASES,
        holdout: SELECTOR_HOLDOUT_CASES,
      }),
      templateMetadataSha256: stableJsonHash(templates.map((template) => ({
        id: template.id,
        visualMetadata: template.visualMetadata,
      }))),
      publishedTemplates: templates.length,
      reviewedMetadata,
    },
    gate: {
      passed: passesSelectorGate(summary, SELECTOR_CASES.length)
        && passesHoldoutGate(holdoutSummary, SELECTOR_HOLDOUT_CASES.length),
      thresholds: {
        development: SELECTOR_GATE,
        holdout: HOLDOUT_GATE,
      },
      failures: {
        development: developmentFailures,
        holdout: holdoutFailures,
      },
    },
    summary,
    rows,
    holdoutSummary,
    holdoutRows,
  };

  writeFileSync(outputPath(), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(
    `cases=${summary.cases} intent_ok=${summary.intentOk} domain_recall=${summary.domainRecall.toFixed(3)} audience_accuracy=${summary.audienceAccuracy.toFixed(3)}`,
  );
  console.log(
    `forbidden_signal_recall=${summary.forbiddenSignalRecall.toFixed(3)} forbidden_template_selections=${summary.forbiddenTemplateSelections}`,
  );
  console.log(
    `holdout_cases=${holdoutSummary.cases} holdout_intent_ok=${holdoutSummary.intentOk} holdout_domain_recall=${holdoutSummary.domainRecall.toFixed(3)} holdout_audience_accuracy=${holdoutSummary.audienceAccuracy.toFixed(3)}`,
  );
  console.log(
    `holdout_diagnostic_signal_compliance=${holdoutSummary.diagnosticSignalCompliance.toFixed(3)} holdout_forbidden_template_selections=${holdoutSummary.forbiddenTemplateSelections}`,
  );
  if (developmentFailures.length > 0 || holdoutFailures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch(() => {
  console.error("selector_eval_failed");
  process.exitCode = 1;
});
