import { z } from "zod";

import { CANONICAL_SECTION_ROLES } from "./structural-taxonomy";
import { SECTION_TYPES } from "@/lib/sections/types";

export const SECTION_PLAN_VERSION = "section-plan/1.0" as const;
export const SECTION_COMPOSITION_MANIFEST_VERSION =
  "section-composition-manifest/1.0" as const;

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
  "inherited_copy_leak",
  "provider_timeout",
  "provider_error",
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
  });

export type SectionCompositionManifest = z.infer<
  typeof SectionCompositionManifestSchema
>;
