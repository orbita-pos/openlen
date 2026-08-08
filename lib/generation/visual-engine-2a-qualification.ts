import { INTENT_PROMPT_VERSION } from "./analyze-intent";
import { VisualEngine2APilotCaseSchema, VISUAL_ENGINE_2A_DATASET_VERSION, type VisualEngine2APilotCase } from "./visual-engine-2a-cohort";
import { canonicalJsonSha256 } from "./visual-engine-2a-eval";
import { DECISION_POLICY_VERSION, decideGenerationRoute } from "./decide-route";
import { SkeletonInventorySchema, type SkeletonInventory } from "./creative-contracts";
import { rankTemplates } from "./score-template";
import { buildSkeletonInventory } from "./skeleton-inventory";
import { TAXONOMY_COMPATIBILITY_VERSION } from "./taxonomy-compatibility";
import { TemplateVisualMetadataSchema, type TemplateVisualMetadata } from "@/lib/templates/visual-metadata";

export interface VisualEngine2AQualifiedTemplate {
  id: string;
  metadataSha256: string;
  htmlSha256: string;
  inventorySha256: string;
}

export interface QualifiedCatalogTemplate {
  id: string;
  status: "published" | "draft" | "archived";
  visualMetadata: TemplateVisualMetadata | null;
  html: string;
  inventory: SkeletonInventory;
}

export type QualificationFailureCode =
  | "invalid_cases"
  | "unsafe_case_source"
  | "invalid_catalog"
  | "invalid_template"
  | "missing_allowlisted_template"
  | "invalid_allowlisted_template"
  | "no_qualified_selection"
  | "insufficient_selected_templates"
  | "template_overrepresented"
  | "manifest_stale";

export type QualificationResult =
  | { ok: true; manifest: VisualEngine2AQualificationManifest }
  | { ok: false; code: QualificationFailureCode };

export interface VisualEngine2AQualificationManifest {
  schemaVersion: "visual-engine-2a-qualification/1.0";
  datasetVersion: typeof VISUAL_ENGINE_2A_DATASET_VERSION;
  datasetSha256: string;
  catalogSha256: string;
  commitSha: string;
  promptVersion: typeof INTENT_PROMPT_VERSION;
  policyVersion: typeof DECISION_POLICY_VERSION;
  taxonomyVersion: typeof TAXONOMY_COMPATIBILITY_VERSION;
  cases: readonly { caseId: string; selectedTemplateId: string; allowedTemplateIdsSha256: string }[];
  templates: readonly VisualEngine2AQualifiedTemplate[];
  baseCaseCount: 15;
  expandedRowCount: 75;
  manifestSha256: string;
}

const FAILURE = (code: QualificationFailureCode): QualificationResult => ({ ok: false, code });
const REQUIRED_ARCHETYPES = [
  "children_creative",
  "restaurant_hospitality",
  "wellness",
  "technical_saas",
  "editorial_portfolio",
] as const;

function values(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(values);
  if (value !== null && typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap(values);
  return [value];
}

function isUnsafeProse(value: string): boolean {
  return /<\/?[a-z][^>]*>/i.test(value)
    || /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value)
    || /\bhttps?:\/\/[^\s/@:]+:[^\s/@]+@/i.test(value)
    || /\b(?:sk|pk|api)[_-]?(?:live|test)?[_-][A-Za-z0-9]{16,}\b/i.test(value)
    || /\bsk-proj-[A-Za-z0-9_-]{16,}\b/i.test(value)
    || /\bAIza[A-Za-z0-9_-]{20,}\b/.test(value)
    || /\bAKIA[0-9A-Z]{16}\b/.test(value)
    || /\bghp_[A-Za-z0-9]{20,}\b/.test(value)
    || /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/.test(value)
    || /(?:^|[\s"'(])(?:[A-Za-z]:)?\\{1,2}(?:[A-Za-z0-9_.-]+\\)+/.test(value)
    || /(?:^|[\s"'(])\/[A-Za-z0-9_.-]+(?:\/[^\s]*)?/.test(value);
}

function casesAreValid(cases: readonly VisualEngine2APilotCase[]): QualificationFailureCode | null {
  if (values(cases).some((value) => typeof value === "string" && isUnsafeProse(value))) return "unsafe_case_source";
  if (!VisualEngine2APilotCaseSchema.array().length(15).safeParse(cases).success) return "invalid_cases";
  if (new Set(cases.map((caseRow) => caseRow.id)).size !== 15) return "invalid_cases";
  if (cases.some((caseRow) => caseRow.datasetVersion !== VISUAL_ENGINE_2A_DATASET_VERSION)) return "invalid_cases";
  if (cases.filter((caseRow) => caseRow.language === "es").length !== 8
    || cases.filter((caseRow) => caseRow.language === "en").length !== 7) return "invalid_cases";
  for (const archetype of REQUIRED_ARCHETYPES) {
    const group = cases.filter((caseRow) => caseRow.archetype === archetype);
    if (group.length !== 3 || group.map((caseRow) => caseRow.briefLength).sort().join(",") !== "detailed,medium,short") return "invalid_cases";
  }
  if (cases.some((caseRow) => caseRow.expectedIntent.language !== caseRow.language
    || caseRow.expectedIntent.requiredVisualSignals.join("\u0000") !== caseRow.requiredVisualSignals.join("\u0000")
    || caseRow.expectedIntent.forbiddenVisualSignals.join("\u0000") !== caseRow.forbiddenVisualSignals.join("\u0000")
    || caseRow.allowedSkeletonTemplateIds.length === 0
    || new Set(caseRow.allowedSkeletonTemplateIds).size !== caseRow.allowedSkeletonTemplateIds.length)) return "invalid_cases";
  return null;
}

function catalogValue(template: QualifiedCatalogTemplate) {
  return {
    id: template.id,
    status: template.status,
    visualMetadata: template.visualMetadata,
    html: template.html,
    inventory: template.inventory,
  };
}

function templateIsBuildable(template: QualifiedCatalogTemplate): boolean {
  if (template.id.trim().length === 0 || template.status !== "published") return false;
  const metadata = TemplateVisualMetadataSchema.safeParse(template.visualMetadata);
  if (!metadata.success || metadata.data.reviewStatus !== "reviewed" || metadata.data.themeability !== "high") return false;
  if (!SkeletonInventorySchema.safeParse(template.inventory).success || template.inventory.templateId !== template.id) return false;
  try {
    return canonicalJsonSha256(buildSkeletonInventory(template.html, template.id)) === canonicalJsonSha256(template.inventory);
  } catch {
    return false;
  }
}

function catalogIsValid(cases: readonly VisualEngine2APilotCase[], templates: readonly QualifiedCatalogTemplate[]): QualificationFailureCode | null {
  if (templates.length === 0 || new Set(templates.map((template) => template.id)).size !== templates.length) return "invalid_catalog";
  const byId = new Map(templates.map((template) => [template.id, template]));
  for (const id of new Set(cases.flatMap((caseRow) => caseRow.allowedSkeletonTemplateIds))) {
    const template = byId.get(id);
    if (!template) return "missing_allowlisted_template";
    if (!templateIsBuildable(template)) return "invalid_allowlisted_template";
  }
  for (const template of templates) {
    if (!templateIsBuildable(template)) return "invalid_template";
  }
  return null;
}

function isCommitSha(value: string): boolean {
  return /^[0-9a-f]{40}$/i.test(value);
}

export function qualifyVisualEngine2ACohort(args: {
  cases: readonly VisualEngine2APilotCase[];
  templates: readonly QualifiedCatalogTemplate[];
  commitSha: string;
}): QualificationResult {
  const caseFailure = casesAreValid(args.cases);
  if (caseFailure) return FAILURE(caseFailure);
  const catalogFailure = catalogIsValid(args.cases, args.templates);
  if (catalogFailure) return FAILURE(catalogFailure);
  if (!isCommitSha(args.commitSha)) return FAILURE("invalid_catalog");

  const templateById = new Map(args.templates.map((template) => [template.id, template]));
  const selected: Array<{ caseRow: VisualEngine2APilotCase; template: QualifiedCatalogTemplate }> = [];
  for (const caseRow of args.cases) {
    const ranked = rankTemplates(caseRow.expectedIntent, args.templates);
    const decision = decideGenerationRoute(ranked);
    if (decision.route !== "template_skeleton" || decision.templateId === null
      || !caseRow.allowedSkeletonTemplateIds.includes(decision.templateId)) return FAILURE("no_qualified_selection");
    const template = templateById.get(decision.templateId);
    if (!template) return FAILURE("no_qualified_selection");
    selected.push({ caseRow, template });
  }

  const selectedCounts = new Map<string, number>();
  for (const { template } of selected) selectedCounts.set(template.id, (selectedCounts.get(template.id) ?? 0) + 1);
  if (selectedCounts.size < 10) return FAILURE("insufficient_selected_templates");
  if ([...selectedCounts.values()].some((count) => count > 2)) return FAILURE("template_overrepresented");

  const cases = selected.map(({ caseRow, template }) => ({
    caseId: caseRow.id,
    selectedTemplateId: template.id,
    allowedTemplateIdsSha256: canonicalJsonSha256([...caseRow.allowedSkeletonTemplateIds].sort()),
  })).sort((left, right) => left.caseId.localeCompare(right.caseId));
  const templates = [...selectedCounts.keys()].sort((left, right) => left.localeCompare(right)).map((id) => {
    const template = templateById.get(id)!;
    return {
      id,
      metadataSha256: canonicalJsonSha256(template.visualMetadata),
      htmlSha256: canonicalJsonSha256(template.html),
      inventorySha256: canonicalJsonSha256(template.inventory),
    };
  });
  const manifestWithoutHash: Omit<VisualEngine2AQualificationManifest, "manifestSha256"> = {
    schemaVersion: "visual-engine-2a-qualification/1.0",
    datasetVersion: VISUAL_ENGINE_2A_DATASET_VERSION,
    datasetSha256: canonicalJsonSha256(args.cases),
    catalogSha256: canonicalJsonSha256([...args.templates].map(catalogValue).sort((left, right) => left.id.localeCompare(right.id))),
    commitSha: args.commitSha,
    promptVersion: INTENT_PROMPT_VERSION,
    policyVersion: DECISION_POLICY_VERSION,
    taxonomyVersion: TAXONOMY_COMPATIBILITY_VERSION,
    cases,
    templates,
    baseCaseCount: 15,
    expandedRowCount: 75,
  };
  return { ok: true, manifest: { ...manifestWithoutHash, manifestSha256: canonicalJsonSha256(manifestWithoutHash) } };
}

function manifestWithoutHash(value: unknown): Omit<VisualEngine2AQualificationManifest, "manifestSha256"> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const { manifestSha256: _manifestSha256, ...manifest } = value as Record<string, unknown>;
  return manifest as Omit<VisualEngine2AQualificationManifest, "manifestSha256">;
}

export function verifyVisualEngine2AQualification(args: {
  manifest: unknown;
  current: Omit<VisualEngine2AQualificationManifest, "manifestSha256">;
}): { ok: true } | { ok: false; code: QualificationFailureCode } {
  if (args.manifest === null || typeof args.manifest !== "object" || Array.isArray(args.manifest)) return { ok: false, code: "manifest_stale" };
  const manifest = args.manifest as Record<string, unknown>;
  const withoutHash = manifestWithoutHash(manifest);
  if (typeof manifest.manifestSha256 !== "string" || withoutHash === null
    || manifest.manifestSha256 !== canonicalJsonSha256(withoutHash)
    || canonicalJsonSha256(withoutHash) !== canonicalJsonSha256(args.current)) {
    return { ok: false, code: "manifest_stale" };
  }
  return { ok: true };
}
