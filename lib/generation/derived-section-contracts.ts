import { z } from "zod";

import { SECTION_SEMANTIC_TAGS } from "./section-variant-semantics";
import { SECTION_TYPES } from "@/lib/sections/types";

const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const Hash12Schema = z.string().regex(/^[a-f0-9]{12}$/);
const SafeCountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const SlugSchema = z.string().min(1).max(128).regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/);

export const DerivedLayoutArchetypeSchema = z.enum([
  "centered", "editorial", "gallery", "grid", "marquee", "media_split", "stacked_cards", "timeline",
]);
export const DerivedDomainSchema = z.enum([
  "children_creativity", "cooking", "education", "entertainment_horror", "hospitality", "physical_product", "professional_services", "saas",
]);
export const DerivedAudienceSchema = z.enum([
  "adults", "children", "creators", "educators", "families", "shoppers", "students", "travelers",
]);
export const DerivedMoodSchema = z.enum([
  "atmospheric", "cinematic", "editorial", "elegant", "energetic", "playful", "tactile", "warm",
]);
export const DerivedSectionRejectionCodeSchema = z.enum([
  "dependency_unavailable",
  "invalid_fragment",
  "unsafe_script",
  "contract_violation",
  "sanitize_mismatch",
  "asset_invalid",
  "render_failed",
  "mobile_overflow",
  "empty_geometry",
  "ambiguous_semantics",
  "exact_duplicate",
  "structural_duplicate",
]);

export const DerivedSectionProvenanceSchema = z.object({
  schemaVersion: z.literal("derived-section-provenance/1.0"),
  sourceTemplateId: SlugSchema,
  sourceTemplateHash: Hash12Schema,
  sourceBandOrdinal: z.number().int().min(0).max(127),
  extractionVersion: z.literal("template-band-extractor/1.0"),
  sourceHash: Sha256Schema,
  structuralFingerprint: Sha256Schema,
}).strict();

export type DerivedSectionProvenance = z.infer<typeof DerivedSectionProvenanceSchema>;

export const DerivedSectionSemanticsSchema = z.object({
  schemaVersion: z.literal("derived-section-semantics/1.0"),
  role: z.enum(SECTION_TYPES),
  layoutArchetypes: z.array(DerivedLayoutArchetypeSchema).max(8),
  domains: z.array(DerivedDomainSchema).max(12),
  audiences: z.array(DerivedAudienceSchema).max(8),
  moods: z.array(DerivedMoodSchema).max(8),
  negativeSignals: z.array(z.enum(SECTION_SEMANTIC_TAGS)).max(16),
}).strict();

export type DerivedSectionSemantics = z.infer<typeof DerivedSectionSemanticsSchema>;

const ReportAcceptedSchema = z.object({
  id: SlugSchema,
  contentHash: Hash12Schema,
  sourceTemplateId: SlugSchema,
  sourceBandOrdinal: z.number().int().min(0).max(127),
  role: DerivedSectionSemanticsSchema.shape.role,
  structuralFingerprint: Sha256Schema,
}).strict();

const ReportDuplicateSchema = z.object({
  rejectedId: SlugSchema,
  representativeId: SlugSchema,
  reason: z.enum(["exact", "structural"]),
}).strict();

const CoverageSchema = z.object({
  kind: z.enum(["role", "domain", "audience", "mood"]),
  value: SlugSchema,
  count: SafeCountSchema,
}).strict();

export const DerivedSectionCompilationReportSchema = z.object({
  schemaVersion: z.literal("derived-section-compilation-report/1.0"),
  corpusManifestHash: Sha256Schema,
  catalogManifestHash: Sha256Schema,
  expectedTemplates: z.literal(451),
  processedTemplates: SafeCountSchema.max(451),
  acceptedCount: SafeCountSchema,
  rejectedCount: SafeCountSchema,
  duplicateCount: SafeCountSchema,
  rejectionCounts: z.record(DerivedSectionRejectionCodeSchema, SafeCountSchema),
  coverage: z.array(CoverageSchema).max(256),
  accepted: z.array(ReportAcceptedSchema).max(10000),
  duplicates: z.array(ReportDuplicateSchema).max(10000),
}).strict();

export type DerivedSectionCompilationReport = z.infer<typeof DerivedSectionCompilationReportSchema>;

interface CompilationInput {
  corpusManifestHash: string;
  catalogManifestHash: string;
  expectedTemplates: 451;
  processedTemplates: number;
  accepted: readonly {
    id: string;
    contentHash: string;
    provenance: DerivedSectionProvenance;
    semantics: DerivedSectionSemantics;
    html: string;
    storageUrl?: string;
  }[];
  rejected: readonly { templateId: string; ordinal: number; code: z.infer<typeof DerivedSectionRejectionCodeSchema>; detail?: string }[];
  duplicates: readonly { rejectedId: string; representativeId: string; reason: "exact" | "structural" }[];
}

export function redactDerivedSectionCompilation(input: CompilationInput): DerivedSectionCompilationReport {
  const rejectionCounts: Partial<Record<z.infer<typeof DerivedSectionRejectionCodeSchema>, number>> = {};
  for (const row of input.rejected) rejectionCounts[row.code] = (rejectionCounts[row.code] ?? 0) + 1;
  const coverageCounts = new Map<string, { kind: "role" | "domain" | "audience" | "mood"; value: string; count: number }>();
  const add = (kind: "role" | "domain" | "audience" | "mood", value: string) => {
    const key = `${kind}:${value}`;
    const current = coverageCounts.get(key);
    coverageCounts.set(key, { kind, value, count: (current?.count ?? 0) + 1 });
  };
  for (const row of input.accepted) {
    add("role", row.semantics.role);
    row.semantics.domains.forEach((value) => add("domain", value));
    row.semantics.audiences.forEach((value) => add("audience", value));
    row.semantics.moods.forEach((value) => add("mood", value));
  }
  return DerivedSectionCompilationReportSchema.parse({
    schemaVersion: "derived-section-compilation-report/1.0",
    corpusManifestHash: input.corpusManifestHash,
    catalogManifestHash: input.catalogManifestHash,
    expectedTemplates: input.expectedTemplates,
    processedTemplates: input.processedTemplates,
    acceptedCount: input.accepted.length,
    rejectedCount: input.rejected.length,
    duplicateCount: input.duplicates.length,
    rejectionCounts,
    coverage: [...coverageCounts.values()].sort((left, right) =>
      left.kind.localeCompare(right.kind) || left.value.localeCompare(right.value)),
    accepted: input.accepted.map((row) => ({
      id: row.id,
      contentHash: row.contentHash,
      sourceTemplateId: row.provenance.sourceTemplateId,
      sourceBandOrdinal: row.provenance.sourceBandOrdinal,
      role: row.semantics.role,
      structuralFingerprint: row.provenance.structuralFingerprint,
    })),
    duplicates: input.duplicates,
  });
}
