import type { IntentAnalysis } from "./contracts";
import { VISUAL_ENGINE_2B_CASES } from "./visual-engine-2b-cohort";
import type { VisualRepairIssueCode } from "./visual-repair-contracts";

export type VisualEngine2CCaseClass = "healthy_keep" | "repairable" | "nonrepairable_or_fallback";
export interface VisualEngine2CCase {
  id: string;
  intent: IntentAnalysis;
  route: "template_skeleton" | "section_composition";
  fixtureId: string;
  class: VisualEngine2CCaseClass;
  expectedInitialDecision: "keep" | "repair" | "nonrepairable";
  expectedCallCeiling: 1 | 3;
  expectedDelivery: "original" | "repaired";
  issueCode: VisualRepairIssueCode | null;
}

const ISSUE_CODES: VisualRepairIssueCode[] = [
  "theme_mismatch", "palette_mismatch", "weak_typography_hierarchy",
  "palette_mismatch", "mobile_overflow", "component_treatment_mismatch",
];

export const VISUAL_ENGINE_2C_CASES: readonly VisualEngine2CCase[] = Object.freeze(
  VISUAL_ENGINE_2B_CASES.map((source, index): VisualEngine2CCase => {
    const kind: VisualEngine2CCaseClass = index < 6 ? "healthy_keep" : index < 12 ? "repairable" : "nonrepairable_or_fallback";
    const syntheticIntent = index === 4
      ? { ...source.intent, requiredVisualSignals: ["serene_hospitality", "boutique_calm"] }
      : source.intent;
    return {
      id: `repair-${String(index + 1).padStart(2, "0")}-${source.id}`,
      intent: syntheticIntent,
      route: index % 2 === 0 ? "template_skeleton" : "section_composition",
      fixtureId: `fixture-2c-${String(index + 1).padStart(2, "0")}`,
      class: kind,
      expectedInitialDecision: kind === "healthy_keep" ? "keep" : kind === "repairable" ? "repair" : "nonrepairable",
      expectedCallCeiling: kind === "repairable" ? 3 : 1,
      expectedDelivery: kind === "repairable" ? "repaired" : "original",
      issueCode: kind === "repairable" ? ISSUE_CODES[index - 6]! : null,
    };
  }),
);
