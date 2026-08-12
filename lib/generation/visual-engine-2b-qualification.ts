import type { SectionRecord } from "@/lib/sections/store";
import { buildSectionCompositionInventory, resolveSectionPlan } from "./section-inventory";
import { planSectionComposition } from "./section-plan";
import { SECTION_PLAN_VERSION } from "./section-composition-contracts";
import { TAXONOMY_COMPATIBILITY_VERSION } from "./taxonomy-compatibility";
import { canonicalJsonSha256 } from "./visual-engine-2a-eval";
import { VISUAL_ENGINE_2B_CASES, type VisualEngine2BCase } from "./visual-engine-2b-cohort";
import { buildDeterministicCreativeDirection } from "./deterministic-creative-direction";

export interface VisualEngine2BQualificationRow {
  caseId: string;
  resultCode: "composed" | "unsupported_section_role" | "section_role_coverage_failed" | "section_fragment_unavailable";
  planSha256: string;
}

export interface VisualEngine2BQualificationManifest {
  schemaVersion: "visual-engine-2b-qualification/1.0";
  commitSha: string;
  inventoryHash: string;
  sectionPlanVersion: typeof SECTION_PLAN_VERSION;
  taxonomyVersion: typeof TAXONOMY_COMPATIBILITY_VERSION;
  caseIds: string[];
  rows: VisualEngine2BQualificationRow[];
  counts: { total: 15; qualified: number; typedFallback: number };
  manifestSha256: string;
}

export interface VisualEngine2BQualificationDeps {
  loadPublishedSections: () => Promise<readonly SectionRecord[]>;
  commitSha: () => Promise<string>;
  cases?: readonly VisualEngine2BCase[];
}

function qualifyCase(
  row: VisualEngine2BCase,
  inventory: ReturnType<typeof buildSectionCompositionInventory>,
): VisualEngine2BQualificationRow {
  const planning = planSectionComposition({
    intent: row.intent,
    intentHash: canonicalJsonSha256(row.intent),
    inventoryHash: inventory.hash,
    availableTypes: new Set(inventory.entries.filter((entry) => !entry.needsJs).map((entry) => entry.type)),
  });
  if (!planning.ok) {
    return { caseId: row.id, resultCode: planning.code, planSha256: canonicalJsonSha256(planning) };
  }
  try {
    const deterministic = buildDeterministicCreativeDirection(row.intent);
    resolveSectionPlan(planning.plan, inventory, {
      intent: row.intent,
      direction: deterministic.direction,
    });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "section_role_coverage_failed";
    return {
      caseId: row.id,
      resultCode: code === "section_fragment_unavailable" ? code : "section_role_coverage_failed",
      planSha256: canonicalJsonSha256(planning.plan),
    };
  }
  const matches = row.expectedRoles?.every((role, index) => planning.plan.rows[index]?.requestedRole === role)
    && row.expectedComponents?.every((type, index) => planning.plan.rows[index]?.componentType === type)
    && planning.plan.rows.length === row.expectedRoles?.length;
  return {
    caseId: row.id,
    resultCode: matches ? "composed" : "section_role_coverage_failed",
    planSha256: canonicalJsonSha256(planning.plan),
  };
}

export async function qualifyVisualEngine2BCohort(
  deps: VisualEngine2BQualificationDeps,
): Promise<{ ok: boolean; manifest: VisualEngine2BQualificationManifest }> {
  const cases = deps.cases ?? VISUAL_ENGINE_2B_CASES;
  const [records, commitSha] = await Promise.all([deps.loadPublishedSections(), deps.commitSha()]);
  if (!/^[a-f0-9]{40}$/i.test(commitSha) || cases.length !== 15) throw new Error("invalid_qualification_input");
  const inventory = buildSectionCompositionInventory(records);
  const rows = cases.map((row) => qualifyCase(row, inventory));
  const qualified = rows.filter((row) => row.resultCode === "composed").length;
  const typedFallback = rows.filter((row) => row.resultCode === "unsupported_section_role").length;
  const unsigned = {
    schemaVersion: "visual-engine-2b-qualification/1.0" as const,
    commitSha,
    inventoryHash: inventory.hash,
    sectionPlanVersion: SECTION_PLAN_VERSION,
    taxonomyVersion: TAXONOMY_COMPATIBILITY_VERSION,
    caseIds: cases.map((row) => row.id),
    rows,
    counts: { total: 15 as const, qualified, typedFallback },
  };
  const manifest = { ...unsigned, manifestSha256: canonicalJsonSha256(unsigned) };
  const expected = new Map(cases.map((row) => [row.id, row.expectedFallback ?? "composed"]));
  const ok = rows.every((row) => expected.get(row.caseId) === row.resultCode)
    && qualified === 13 && typedFallback === 2;
  return { ok, manifest };
}

export function verifyVisualEngine2BQualification(
  manifest: VisualEngine2BQualificationManifest,
  current: { commitSha: string; inventoryHash: string },
): boolean {
  const { manifestSha256, ...unsigned } = manifest;
  const expectedIds = VISUAL_ENGINE_2B_CASES.map((row) => row.id);
  return manifest.schemaVersion === "visual-engine-2b-qualification/1.0"
    && manifest.commitSha === current.commitSha
    && manifest.inventoryHash === current.inventoryHash
    && manifest.sectionPlanVersion === SECTION_PLAN_VERSION
    && manifest.taxonomyVersion === TAXONOMY_COMPATIBILITY_VERSION
    && manifest.counts.total === 15
    && manifest.counts.qualified === 13
    && manifest.counts.typedFallback === 2
    && manifest.rows.length === 15
    && manifest.caseIds.length === 15
    && manifest.caseIds.every((id, index) => id === expectedIds[index])
    && manifest.rows.every((row, index) => row.caseId === expectedIds[index]
      && row.resultCode === (VISUAL_ENGINE_2B_CASES[index].expectedFallback ?? "composed")
      && /^sha256:[a-f0-9]{64}$/.test(row.planSha256))
    && manifestSha256 === canonicalJsonSha256(unsigned);
}
