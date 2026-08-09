import { createHash } from "node:crypto";
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

export interface SelectionCatalogTemplate {
  id: string;
  status: "published" | "draft" | "archived";
  visualMetadata: TemplateVisualMetadata | null;
}

export interface TemplateMaterial {
  id: string;
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
const HTML_RAW_TEXT_ELEMENTS = new Set([
  "iframe",
  "noembed",
  "noframes",
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
]);

function cloudflareEmailHash(value: string): string | null {
  if (value.length < 4 || value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) return null;
  const bytes = Buffer.from(value, "hex");
  const key = bytes[0];
  const decoded = Buffer.from(bytes.subarray(1).map((byte) => byte ^ key));
  return `sha256:${createHash("sha256").update(decoded).digest("hex")}`;
}

function isHtmlWhitespace(character: string): boolean {
  return character === " " || character === "\t" || character === "\n" || character === "\r" || character === "\f";
}

function findTagEnd(html: string, start: number): number {
  let quote: "\"" | "'" | null = null;
  for (let index = start + 1; index < html.length; index += 1) {
    const character = html[index];
    if (quote !== null) {
      if (character === quote) quote = null;
    } else if (character === "\"" || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
}

function canonicalizeCloudflareAttributeInStartTag(startTag: string, tagNameEnd: number): string {
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  let index = tagNameEnd;
  while (index < startTag.length - 1) {
    while (isHtmlWhitespace(startTag[index] ?? "")) index += 1;
    if (index >= startTag.length - 1 || startTag[index] === "/" || startTag[index] === ">") break;

    const nameStart = index;
    while (index < startTag.length - 1
      && !isHtmlWhitespace(startTag[index])
      && startTag[index] !== "="
      && startTag[index] !== "/"
      && startTag[index] !== ">") index += 1;
    const name = startTag.slice(nameStart, index);
    if (name.length === 0) {
      index += 1;
      continue;
    }

    while (isHtmlWhitespace(startTag[index] ?? "")) index += 1;
    if (startTag[index] !== "=") continue;
    index += 1;
    while (isHtmlWhitespace(startTag[index] ?? "")) index += 1;

    const quote = startTag[index] === "\"" || startTag[index] === "'" ? startTag[index] : null;
    if (quote !== null) index += 1;
    const valueStart = index;
    if (quote !== null) {
      while (index < startTag.length - 1 && startTag[index] !== quote) index += 1;
      if (startTag[index] !== quote) break;
    } else {
      while (index < startTag.length - 1 && !isHtmlWhitespace(startTag[index]) && startTag[index] !== ">") index += 1;
    }
    const valueEnd = index;
    if (quote !== null) index += 1;

    if (name.toLowerCase() !== "data-cfemail") continue;
    const hash = cloudflareEmailHash(startTag.slice(valueStart, valueEnd));
    if (hash !== null) replacements.push({ start: valueStart, end: valueEnd, value: hash });
  }

  if (replacements.length === 0) return startTag;
  let canonical = "";
  let cursor = 0;
  for (const replacement of replacements) {
    canonical += startTag.slice(cursor, replacement.start) + replacement.value;
    cursor = replacement.end;
  }
  return canonical + startTag.slice(cursor);
}

function rawTextEnd(htmlLowerCase: string, start: number, tagName: string): number {
  const closingPrefix = `</${tagName}`;
  let candidate = htmlLowerCase.indexOf(closingPrefix, start);
  while (candidate !== -1) {
    const boundary = htmlLowerCase[candidate + closingPrefix.length] ?? "";
    if (boundary === ">" || boundary === "/" || isHtmlWhitespace(boundary)) return candidate;
    candidate = htmlLowerCase.indexOf(closingPrefix, candidate + closingPrefix.length);
  }
  return htmlLowerCase.length;
}

function canonicalizeCloudflareEmailProtection(html: string): string {
  const htmlLowerCase = html.toLowerCase();
  let canonical = "";
  let cursor = 0;
  let scan = 0;
  while (scan < html.length) {
    const tagStart = html.indexOf("<", scan);
    if (tagStart === -1) break;
    if (html.startsWith("<!--", tagStart)) {
      const commentEnd = html.indexOf("-->", tagStart + 4);
      if (commentEnd === -1) break;
      scan = commentEnd + 3;
      continue;
    }

    const first = html[tagStart + 1] ?? "";
    if (!/[A-Za-z]/.test(first)) {
      if (first === "/" || first === "!" || first === "?") {
        const ignoredTagEnd = findTagEnd(html, tagStart);
        scan = ignoredTagEnd === -1 ? html.length : ignoredTagEnd + 1;
      } else {
        scan = tagStart + 1;
      }
      continue;
    }

    const tagEnd = findTagEnd(html, tagStart);
    if (tagEnd === -1) break;
    let tagNameEnd = tagStart + 1;
    while (tagNameEnd < tagEnd
      && !isHtmlWhitespace(html[tagNameEnd])
      && html[tagNameEnd] !== "/"
      && html[tagNameEnd] !== ">") tagNameEnd += 1;
    const tagName = html.slice(tagStart + 1, tagNameEnd).toLowerCase();
    const startTag = html.slice(tagStart, tagEnd + 1);
    canonical += html.slice(cursor, tagStart)
      + canonicalizeCloudflareAttributeInStartTag(startTag, tagNameEnd - tagStart);
    cursor = tagEnd + 1;
    scan = cursor;

    if (HTML_RAW_TEXT_ELEMENTS.has(tagName)) {
      scan = rawTextEnd(htmlLowerCase, scan, tagName);
    }
  }
  return canonical + html.slice(cursor);
}

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
    || /(?:^|[\s"'(])(?:[A-Za-z]:)?\\{1,2}[A-Za-z0-9_.-]+(?:\\[A-Za-z0-9_.-]+)*/.test(value)
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

function catalogValue(template: SelectionCatalogTemplate) {
  return {
    id: template.id,
    status: template.status,
    visualMetadata: template.visualMetadata,
  };
}

function selectionTemplateIsAllowlisted(template: SelectionCatalogTemplate): boolean {
  if (template.id.trim().length === 0 || template.status !== "published") return false;
  const metadata = TemplateVisualMetadataSchema.safeParse(template.visualMetadata);
  if (!metadata.success || metadata.data.reviewStatus !== "reviewed" || metadata.data.themeability !== "high") return false;
  return true;
}

function materialIsBuildable(template: TemplateMaterial): boolean {
  if (template.id.trim().length === 0) return false;
  if (!SkeletonInventorySchema.safeParse(template.inventory).success || template.inventory.templateId !== template.id) return false;
  try {
    return canonicalJsonSha256(buildSkeletonInventory(template.html, template.id)) === canonicalJsonSha256(template.inventory);
  } catch {
    return false;
  }
}

function catalogIsValid(
  cases: readonly VisualEngine2APilotCase[],
  selectionCatalog: readonly SelectionCatalogTemplate[],
  templateMaterials: readonly TemplateMaterial[],
): QualificationFailureCode | null {
  if (selectionCatalog.length === 0 || new Set(selectionCatalog.map((template) => template.id)).size !== selectionCatalog.length) return "invalid_catalog";
  const allowedIds = new Set(cases.flatMap((caseRow) => caseRow.allowedSkeletonTemplateIds));
  const selectionById = new Map(selectionCatalog.map((template) => [template.id, template]));
  const materialById = new Map(templateMaterials.map((template) => [template.id, template]));
  for (const id of allowedIds) {
    const selection = selectionById.get(id);
    if (!selection) return "missing_allowlisted_template";
    if (!selectionTemplateIsAllowlisted(selection)) return "invalid_allowlisted_template";
    const material = materialById.get(id);
    if (!material) return "invalid_allowlisted_template";
  }
  if (templateMaterials.length !== allowedIds.size
    || new Set(templateMaterials.map((template) => template.id)).size !== templateMaterials.length
    || templateMaterials.some((template) => !allowedIds.has(template.id))) return "invalid_template";
  for (const id of allowedIds) {
    if (!materialIsBuildable(materialById.get(id)!)) return "invalid_allowlisted_template";
  }
  return null;
}

function isCommitSha(value: string): boolean {
  return /^[0-9a-f]{40}$/i.test(value);
}

export function qualifyVisualEngine2ACohort(args: {
  cases: readonly VisualEngine2APilotCase[];
  selectionCatalog: readonly SelectionCatalogTemplate[];
  templateMaterials: readonly TemplateMaterial[];
  commitSha: string;
}): QualificationResult {
  const caseFailure = casesAreValid(args.cases);
  if (caseFailure) return FAILURE(caseFailure);
  const catalogFailure = catalogIsValid(args.cases, args.selectionCatalog, args.templateMaterials);
  if (catalogFailure) return FAILURE(catalogFailure);
  if (!isCommitSha(args.commitSha)) return FAILURE("invalid_catalog");

  const selectionById = new Map(args.selectionCatalog.map((template) => [template.id, template]));
  const materialById = new Map(args.templateMaterials.map((template) => [template.id, template]));
  const selected: Array<{ caseRow: VisualEngine2APilotCase; template: SelectionCatalogTemplate }> = [];
  for (const caseRow of args.cases) {
    const ranked = rankTemplates(caseRow.expectedIntent, args.selectionCatalog);
    const decision = decideGenerationRoute(ranked);
    if (decision.route !== "template_skeleton" || decision.templateId === null
      || !caseRow.allowedSkeletonTemplateIds.includes(decision.templateId)) return FAILURE("no_qualified_selection");
    const template = selectionById.get(decision.templateId);
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
  const templates = [...new Set(args.cases.flatMap((caseRow) => caseRow.allowedSkeletonTemplateIds))].sort((left, right) => left.localeCompare(right)).map((id) => {
    const template = selectionById.get(id)!;
    const material = materialById.get(id)!;
    const canonicalHtml = canonicalizeCloudflareEmailProtection(material.html);
    const canonicalInventory = buildSkeletonInventory(canonicalHtml, material.id);
    return {
      id,
      metadataSha256: canonicalJsonSha256(template.visualMetadata),
      htmlSha256: canonicalJsonSha256(canonicalHtml),
      inventorySha256: canonicalJsonSha256(canonicalInventory),
    };
  });
  const manifestWithoutHash: Omit<VisualEngine2AQualificationManifest, "manifestSha256"> = {
    schemaVersion: "visual-engine-2a-qualification/1.0",
    datasetVersion: VISUAL_ENGINE_2A_DATASET_VERSION,
    datasetSha256: canonicalJsonSha256(args.cases),
    catalogSha256: canonicalJsonSha256([...args.selectionCatalog].map(catalogValue).sort((left, right) => left.id.localeCompare(right.id))),
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
