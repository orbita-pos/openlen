import { describe, expect, it } from "vitest";

import {
  SECTION_COMPOSITION_MANIFEST_VERSION,
  SECTION_PLAN_VERSION,
  SectionCompositionManifestSchema,
  SectionCompositionResultCodeSchema,
  SectionPlanSchema,
  hasOriginalSectionProvenance,
} from "./section-composition-contracts";

const SHA_A = `sha256:${"a".repeat(64)}`;
const SHA_B = `sha256:${"b".repeat(64)}`;
const SHA_C = `sha256:${"c".repeat(64)}`;
const SHA_D = `sha256:${"d".repeat(64)}`;

const PLAN = {
  schemaVersion: "section-plan/1.0",
  intentHash: SHA_A,
  inventoryHash: SHA_B,
  rows: [
    {
      ordinal: 0,
      requestedRole: "hero",
      componentType: "hero",
      compatibilityKind: "exact",
      compatibilityScore: 1,
      compatibilityRuleId: "section_component:exact:hero",
      required: true,
    },
    {
      ordinal: 1,
      requestedRole: "activities",
      componentType: "features",
      compatibilityKind: "structural",
      compatibilityScore: 0.85,
      compatibilityRuleId: "section_component:structural:activities>features",
      required: true,
    },
  ],
} as const;

const MANIFEST = {
  schemaVersion: "section-composition-manifest/2.0",
  intentHash: SHA_A,
  creativeDirectionHash: SHA_B,
  inventoryHash: SHA_C,
  orderedRoles: ["hero", "activities"],
  selectedSectionIds: ["hero-01", "features-02"],
  selectedContentHashes: ["a".repeat(12), "b".repeat(12)],
  selectedSourceKinds: ["template_derived", "template_derived"],
  selectedSourceTemplateIds: ["arcana", "obra"],
  selectedSourceBandOrdinals: [0, 1],
  selectedStructuralFingerprints: [SHA_A, SHA_B],
  compatibilityRuleIds: [
    "section_component:exact:hero",
    "section_component:structural:activities>features",
  ],
  outputHash: SHA_D,
  resultCode: "composed",
} as const;

describe("section composition contracts", () => {
  it("accepts only the versioned strict section-plan shape", () => {
    expect(SECTION_PLAN_VERSION).toBe("section-plan/1.0");
    expect(SectionPlanSchema.parse(PLAN)).toEqual(PLAN);
    expect(SectionPlanSchema.safeParse({ ...PLAN, brief: "private user brief" }).success).toBe(false);
    expect(SectionPlanSchema.safeParse({ ...PLAN, rows: [{ ...PLAN.rows[0], requestedRole: "not_canonical" }] }).success).toBe(false);
  });

  it("accepts exactly the fixed result-code vocabulary", () => {
    expect(SectionCompositionResultCodeSchema.options).toEqual([
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
      "invalid_provider_response",
      "model_incompatible",
      "css_policy_violation",
      "contrast_violation",
      "required_asset_unavailable",
      "sanitization_failed",
      "technical_render_failed",
      "internal_error",
    ]);
  });

  it("keeps the composition manifest scalar, redacted, aligned, and strict", () => {
    expect(SECTION_COMPOSITION_MANIFEST_VERSION).toBe("section-composition-manifest/2.0");
    expect(SectionCompositionManifestSchema.parse(MANIFEST)).toEqual(MANIFEST);
    expect(SectionCompositionManifestSchema.safeParse({ ...MANIFEST, html: "<html>secret</html>" }).success).toBe(false);
    expect(SectionCompositionManifestSchema.safeParse({ ...MANIFEST, selectedSectionIds: ["hero-01"] }).success).toBe(false);
    expect(SectionCompositionManifestSchema.safeParse({ ...MANIFEST, selectedSourceTemplateIds: ["arcana"] }).success).toBe(false);
    expect(SectionCompositionManifestSchema.safeParse({ ...MANIFEST, selectedSourceKinds: ["manual", "template_derived"] }).success).toBe(false);
    expect(SectionCompositionManifestSchema.safeParse({ ...MANIFEST, outputHash: null }).success).toBe(false);
    expect(SectionCompositionManifestSchema.safeParse({ ...MANIFEST, resultCode: "provider_error", outputHash: null }).success).toBe(true);
  });

  it("counts generated fingerprints as distinct sources but still requires two real donors", () => {
    const base = {
      contentHashes: ["a".repeat(12), "b".repeat(12), "c".repeat(12)],
      sourceKinds: ["template_derived", "template_derived", "generated"] as const,
      sourceTemplateIds: ["arcana", "obra", null],
      sourceBandOrdinals: [0, 1, null],
      structuralFingerprints: [SHA_A, SHA_B, SHA_C],
    };
    expect(hasOriginalSectionProvenance(base)).toBe(true);
    expect(hasOriginalSectionProvenance({ ...base, sourceTemplateIds: ["arcana", "arcana", null] })).toBe(false);
    expect(hasOriginalSectionProvenance({ ...base, structuralFingerprints: [SHA_A, SHA_B, ""] })).toBe(false);
  });
});
