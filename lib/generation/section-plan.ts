import type { IntentAnalysis } from "./contracts";
import {
  SECTION_PLAN_VERSION,
  SectionPlanSchema,
  type SectionPlan,
} from "./section-composition-contracts";
import {
  CANONICAL_SECTION_ROLES,
  type CanonicalSectionRole,
} from "./structural-taxonomy";
import { sectionComponentCompatibility } from "./taxonomy-compatibility";
import { SECTION_TYPES, type SectionType } from "@/lib/sections/types";

export interface PlanSectionCompositionInput {
  intent: IntentAnalysis;
  intentHash: string;
  inventoryHash: string;
  availableTypes: ReadonlySet<SectionType>;
}

export type PlanAdaptiveSectionCompositionInput = Omit<PlanSectionCompositionInput, "availableTypes">;

export type SectionPlanningResult =
  | { ok: true; plan: SectionPlan }
  | {
      ok: false;
      code: "unsupported_section_role" | "section_role_coverage_failed";
    };

const CANONICAL_ROLE_SET = new Set<string>(CANONICAL_SECTION_ROLES);

function selectComponent(
  role: CanonicalSectionRole,
  availableTypes: ReadonlySet<SectionType>,
) {
  return SECTION_TYPES
    .filter((componentType) => availableTypes.has(componentType))
    .map((componentType) => ({
      componentType,
      compatibility: sectionComponentCompatibility(role, componentType),
    }))
    .filter(({ compatibility }) =>
      compatibility.kind === "exact" ||
      compatibility.kind === "alias" ||
      compatibility.kind === "structural")
    .sort((left, right) => right.compatibility.score - left.compatibility.score)[0];
}

export function planSectionComposition(
  input: PlanSectionCompositionInput,
): SectionPlanningResult {
  const requested = input.intent.functional.requiredSections;
  if (new Set(requested).size !== requested.length) {
    return { ok: false, code: "section_role_coverage_failed" };
  }
  if (requested.some((role) => !CANONICAL_ROLE_SET.has(role))) {
    return { ok: false, code: "unsupported_section_role" };
  }

  const middle = requested.filter((role) => role !== "header" && role !== "footer");
  const orderedRoles: string[] = [];
  if (requested.includes("header") || input.availableTypes.has("navbar")) {
    orderedRoles.push("header");
  }
  orderedRoles.push(...middle);
  if (requested.includes("footer") || input.availableTypes.has("footer")) {
    orderedRoles.push("footer");
  }

  const rows = [];
  for (const [ordinal, requestedRole] of orderedRoles.entries()) {
    const selected = selectComponent(
      requestedRole as CanonicalSectionRole,
      input.availableTypes,
    );
    if (!selected || selected.compatibility.ruleId === null) {
      return { ok: false, code: "unsupported_section_role" };
    }
    rows.push({
      ordinal,
      requestedRole,
      componentType: selected.componentType,
      compatibilityKind: selected.compatibility.kind,
      compatibilityScore: selected.compatibility.score,
      compatibilityRuleId: selected.compatibility.ruleId,
      required: true as const,
    });
  }

  return {
    ok: true,
    plan: SectionPlanSchema.parse({
      schemaVersion: SECTION_PLAN_VERSION,
      intentHash: input.intentHash,
      inventoryHash: input.inventoryHash,
      rows,
    }),
  };
}

export function planAdaptiveSectionComposition(
  input: PlanAdaptiveSectionCompositionInput,
): SectionPlanningResult {
  const requested = input.intent.functional.requiredSections;
  if (new Set(requested).size !== requested.length) return { ok: false, code: "section_role_coverage_failed" };
  if (requested.some((role) => !CANONICAL_ROLE_SET.has(role))) return { ok: false, code: "unsupported_section_role" };

  const rows = [];
  const allTypes = new Set<SectionType>(SECTION_TYPES);
  for (const [ordinal, requestedRole] of requested.entries()) {
    const selected = selectComponent(requestedRole as CanonicalSectionRole, allTypes);
    if (!selected || selected.compatibility.ruleId === null) return { ok: false, code: "unsupported_section_role" };
    rows.push({
      ordinal,
      requestedRole,
      componentType: selected.componentType,
      compatibilityKind: selected.compatibility.kind,
      compatibilityScore: selected.compatibility.score,
      compatibilityRuleId: selected.compatibility.ruleId,
      required: true as const,
    });
  }
  return {
    ok: true,
    plan: SectionPlanSchema.parse({
      schemaVersion: SECTION_PLAN_VERSION,
      intentHash: input.intentHash,
      inventoryHash: input.inventoryHash,
      rows,
    }),
  };
}
