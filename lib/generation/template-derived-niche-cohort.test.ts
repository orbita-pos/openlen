import { describe, expect, it } from "vitest";
import { SectionCompositionManifestSchema } from "./section-composition-contracts";
import { evaluateTemplateDerivedNiche, TEMPLATE_DERIVED_NICHE_CASES } from "./template-derived-niche-cohort";

const sha = (digit: string) => `sha256:${digit.repeat(64)}`;
function evidence(row: (typeof TEMPLATE_DERIVED_NICHE_CASES)[number]) {
  const length = row.requiredRoles.length;
  const manifest = SectionCompositionManifestSchema.parse({
    schemaVersion: "section-composition-manifest/2.0", intentHash: sha("a"), creativeDirectionHash: sha("b"), inventoryHash: sha("c"),
    orderedRoles: row.requiredRoles, selectedSectionIds: row.requiredRoles.map((role, index) => `${role}-${index}`),
    selectedContentHashes: row.requiredRoles.map((_role, index) => index.toString(16).padStart(12, "0")),
    selectedSourceKinds: row.requiredRoles.map(() => "template_derived"),
    selectedSourceTemplateIds: row.requiredRoles.map((_role, index) => `donor-${Math.floor(index / 2)}`),
    selectedSourceBandOrdinals: row.requiredRoles.map((_role, index) => index),
    selectedStructuralFingerprints: row.requiredRoles.map((_role, index) => sha(String((index % 9) + 1))),
    compatibilityRuleIds: row.requiredRoles.map((role) => `section_component:exact:${role}`), outputHash: sha("d"), resultCode: "composed",
  });
  return { manifest, semanticFamilies: [row.positiveSemanticFamilies[0]], visibleText: "original niche copy", resolvedAssetMedia: row.requiredAssetMedia, exactRoleMarkers: true, mobileOverflow: false, weakTypography: false, invalidGeometry: false };
}

describe("template-derived six-niche acceptance", () => {
  it("defines exactly the six approved niches with no generic least-bad fallback", () => {
    expect(TEMPLATE_DERIVED_NICHE_CASES.map((row) => row.id)).toEqual(["kids-coloring", "horror-experience", "school-community", "cooking-editorial", "boutique-hotel", "physical-product"]);
    expect(TEMPLATE_DERIVED_NICHE_CASES).toHaveLength(6);
  });
  it.each(TEMPLATE_DERIVED_NICHE_CASES)("accepts a diverse, exact, healthy $id composition", (row) => {
    expect(evaluateTemplateDerivedNiche(row, evidence(row))).toBe(true);
  });
  it.each(TEMPLATE_DERIVED_NICHE_CASES)("rejects forbidden semantics, donor collapse and visual defects for $id", (row) => {
    const valid = evidence(row);
    expect(evaluateTemplateDerivedNiche(row, { ...valid, semanticFamilies: [row.forbiddenSignals[0]] })).toBe(false);
    expect(evaluateTemplateDerivedNiche(row, { ...valid, mobileOverflow: true })).toBe(false);
    expect(evaluateTemplateDerivedNiche(row, { ...valid, manifest: { ...valid.manifest, selectedSourceTemplateIds: valid.manifest.selectedSourceTemplateIds.map(() => "one-donor") } })).toBe(false);
  });
});
