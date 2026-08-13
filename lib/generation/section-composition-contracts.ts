import { z } from "zod";

import { CANONICAL_SECTION_ROLES } from "./structural-taxonomy";
import { SECTION_TYPES } from "@/lib/sections/types";

export const SECTION_PLAN_VERSION = "section-plan/1.0" as const;
export const SECTION_COMPOSITION_MANIFEST_VERSION =
  "section-composition-manifest/2.0" as const;
export const ADAPTIVE_SECTION_COMPOSITION_MANIFEST_VERSION =
  "adaptive-section-composition-manifest/1.0" as const;

const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const ContentHashSchema = z.string().regex(/^[a-f0-9]{12}$/);
const SectionIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/);
const CompatibilityRuleIdSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^section_component:[a-z0-9_>:-]+$/);

export const SectionCompositionResultCodeSchema = z.enum([
  "composed",
  "route_ineligible",
  "unsupported_section_role",
  "section_inventory_stale",
  "section_fragment_unavailable",
  "section_fragment_stale",
  "section_fragment_invalid",
  "section_role_coverage_failed",
  "section_semantic_coverage_failed",
  "section_originality_failed",
  "inherited_copy_leak",
  "provider_timeout",
  "provider_error",
  "budget_exceeded",
  "invalid_provider_response",
  "model_incompatible",
  "css_policy_violation",
  "contrast_violation",
  "required_asset_unavailable",
  "sanitization_failed",
  "technical_render_failed",
  "internal_error",
]);

export type SectionCompositionResultCode = z.infer<
  typeof SectionCompositionResultCodeSchema
>;

export const SectionPlanRowSchema = z
  .object({
    ordinal: z.number().int().min(0).max(31),
    requestedRole: z.enum(
      CANONICAL_SECTION_ROLES as unknown as [
        (typeof CANONICAL_SECTION_ROLES)[number],
        ...(typeof CANONICAL_SECTION_ROLES)[number][],
      ],
    ),
    componentType: z.enum(
      SECTION_TYPES as unknown as [
        (typeof SECTION_TYPES)[number],
        ...(typeof SECTION_TYPES)[number][],
      ],
    ),
    compatibilityKind: z.enum(["exact", "alias", "structural"]),
    compatibilityScore: z.number().min(0).max(1),
    compatibilityRuleId: CompatibilityRuleIdSchema,
    required: z.literal(true),
  })
  .strict();

export const SectionPlanSchema = z
  .object({
    schemaVersion: z.literal(SECTION_PLAN_VERSION),
    intentHash: Sha256Schema,
    inventoryHash: Sha256Schema,
    rows: z.array(SectionPlanRowSchema).min(1).max(32),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ordinals = value.rows.map((row) => row.ordinal);
    if (new Set(ordinals).size !== ordinals.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rows"],
        message: "section plan ordinals must be unique",
      });
    }
    ordinals.forEach((ordinal, index) => {
      if (ordinal !== index) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rows", index, "ordinal"],
          message: "section plan ordinals must be contiguous and ordered",
        });
      }
    });
  });

export type SectionPlan = z.infer<typeof SectionPlanSchema>;
export type SectionPlanRow = z.infer<typeof SectionPlanRowSchema>;

export const SectionCompositionManifestSchema = z
  .object({
    schemaVersion: z.literal(SECTION_COMPOSITION_MANIFEST_VERSION),
    intentHash: Sha256Schema,
    creativeDirectionHash: Sha256Schema,
    inventoryHash: Sha256Schema,
    orderedRoles: z.array(SectionPlanRowSchema.shape.requestedRole).max(32),
    selectedSectionIds: z.array(SectionIdSchema).max(32),
    selectedContentHashes: z.array(ContentHashSchema).max(32),
    selectedSourceKinds: z.array(z.enum(["manual", "template_derived", "generated"])).max(32),
    selectedSourceTemplateIds: z.array(SectionIdSchema.nullable()).max(32),
    selectedSourceBandOrdinals: z.array(z.number().int().min(0).max(127).nullable()).max(32),
    selectedStructuralFingerprints: z.array(Sha256Schema).max(32),
    compatibilityRuleIds: z.array(CompatibilityRuleIdSchema).max(32),
    outputHash: Sha256Schema.nullable(),
    resultCode: SectionCompositionResultCodeSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const lengths = [
      value.orderedRoles.length,
      value.selectedSectionIds.length,
      value.selectedContentHashes.length,
      value.selectedSourceKinds.length,
      value.selectedSourceTemplateIds.length,
      value.selectedSourceBandOrdinals.length,
      value.selectedStructuralFingerprints.length,
      value.compatibilityRuleIds.length,
    ];
    if (new Set(lengths).size !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "composition manifest row arrays must be aligned",
      });
    }
    if (value.resultCode === "composed" && value.outputHash === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outputHash"],
        message: "composed manifests require an output hash",
      });
    }
    if (value.resultCode !== "composed" && value.outputHash !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outputHash"],
        message: "failed manifests must not retain an output hash",
      });
    }
    value.selectedSourceKinds.forEach((kind, index) => {
      const templateId = value.selectedSourceTemplateIds[index];
      const ordinal = value.selectedSourceBandOrdinals[index];
      if (kind === "template_derived" && (templateId === null || ordinal === null)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["selectedSourceKinds", index], message: "template-derived rows require provenance" });
      }
      if (kind !== "template_derived" && (templateId !== null || ordinal !== null)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["selectedSourceKinds", index], message: "non-template rows cannot claim template provenance" });
      }
    });
  });

export type SectionCompositionManifest = z.infer<
  typeof SectionCompositionManifestSchema
>;

export const AdaptiveSectionCompositionManifestSchema = z.object({
  schemaVersion: z.literal(ADAPTIVE_SECTION_COMPOSITION_MANIFEST_VERSION),
  actions: z.array(z.enum(["reuse", "rebuild", "generate"])).max(32),
  orderedRoles: z.array(SectionPlanRowSchema.shape.requestedRole).max(32),
  selectedCandidateIds: z.array(SectionIdSchema.nullable()).max(32),
  sourceTemplateIds: z.array(SectionIdSchema.nullable()).max(32),
  sourceBandOrdinals: z.array(z.number().int().min(0).max(127).nullable()).max(32),
  finalContentHashes: z.array(ContentHashSchema).max(32),
  finalStructuralFingerprints: z.array(Sha256Schema).max(32),
  finalProgramHashes: z.array(Sha256Schema.nullable()).max(32),
  outputHash: Sha256Schema.nullable(),
  resultCode: SectionCompositionResultCodeSchema,
}).strict().superRefine((value, ctx) => {
  const lengths = [
    value.actions.length,
    value.orderedRoles.length,
    value.selectedCandidateIds.length,
    value.sourceTemplateIds.length,
    value.sourceBandOrdinals.length,
    value.finalContentHashes.length,
    value.finalStructuralFingerprints.length,
    value.finalProgramHashes.length,
  ];
  if (new Set(lengths).size !== 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "adaptive composition manifest arrays must be aligned" });
  }
  if ((value.resultCode === "composed") !== (value.outputHash !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["outputHash"], message: "only composed output has a hash" });
  }
  value.actions.forEach((action, index) => {
    const candidateId = value.selectedCandidateIds[index];
    const templateId = value.sourceTemplateIds[index];
    const bandOrdinal = value.sourceBandOrdinals[index];
    const programHash = value.finalProgramHashes[index];
    if ((templateId === null) !== (bandOrdinal === null)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sourceTemplateIds", index], message: "template provenance must be paired" });
    }
    if (action === "generate" && (candidateId !== null || templateId !== null || programHash === null)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["actions", index], message: "generate has only program provenance" });
    }
    if (action === "rebuild" && (candidateId === null || programHash === null)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["actions", index], message: "rebuild requires candidate and program provenance" });
    }
    if (action === "reuse" && (candidateId === null || programHash !== null)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["actions", index], message: "reuse requires exact candidate provenance" });
    }
  });
});

export type AdaptiveSectionCompositionManifest = z.infer<typeof AdaptiveSectionCompositionManifestSchema>;

export function hasOriginalSectionProvenance(input: {
  contentHashes: readonly string[];
  sourceKinds: readonly ("manual" | "template_derived" | "generated")[];
  sourceTemplateIds: readonly (string | null)[];
  sourceBandOrdinals: readonly (number | null)[];
  structuralFingerprints?: readonly string[];
}): boolean {
  const length = input.contentHashes.length;
  if (length < 3 || [input.sourceKinds, input.sourceTemplateIds, input.sourceBandOrdinals].some((rows) => rows.length !== length)) return false;
  if (input.structuralFingerprints && input.structuralFingerprints.length !== length) return false;
  if (new Set(input.contentHashes).size < 3) return false;
  const donorCounts = new Map<string, number>();
  const generatedSources = new Set<string>();
  for (let index = 0; index < length; index += 1) {
    if (input.sourceKinds[index] === "generated") {
      const fingerprint = input.structuralFingerprints?.[index];
      if (!fingerprint) return false;
      generatedSources.add(`generated:${fingerprint}`);
      continue;
    }
    if (input.sourceKinds[index] !== "template_derived") continue;
    const donor = input.sourceTemplateIds[index];
    const ordinal = input.sourceBandOrdinals[index];
    if (donor === null || ordinal === null) return false;
    donorCounts.set(donor, (donorCounts.get(donor) ?? 0) + 1);
  }
  const minimumRealDonors = generatedSources.size >= 3 ? 0 : generatedSources.size > 0 ? 2 : 3;
  if (donorCounts.size < minimumRealDonors || donorCounts.size + generatedSources.size < 3 || [...donorCounts.values()].some((count) => count > 2)) return false;
  for (let index = 0; index + 2 < length; index += 1) {
    const donor = input.sourceTemplateIds[index];
    const ordinal = input.sourceBandOrdinals[index];
    if (input.sourceKinds[index] === "template_derived"
      && input.sourceKinds[index + 1] === "template_derived"
      && input.sourceKinds[index + 2] === "template_derived"
      && donor !== null
      && donor === input.sourceTemplateIds[index + 1]
      && donor === input.sourceTemplateIds[index + 2]
      && ordinal !== null
      && input.sourceBandOrdinals[index + 1] === ordinal + 1
      && input.sourceBandOrdinals[index + 2] === ordinal + 2) return false;
  }
  return true;
}
