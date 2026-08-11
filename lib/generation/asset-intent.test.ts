import { describe, expect, it } from "vitest";

import { buildAssetIntents, AssetIntentError } from "@/lib/generation/asset-intent";
import { CreativeDirectionSchema, SkeletonAdaptationPlanSchema, SkeletonInventorySchema, type SkeletonAdaptationPlan } from "@/lib/generation/creative-contracts";
import { IntentAnalysisSchema } from "@/lib/generation/contracts";

const intent = IntentAnalysisSchema.parse({
  schemaVersion: "intent-analysis/1.0", language: "en",
  functional: { siteType: "coloring_pages", requiredSections: ["hero"], primaryActions: ["download"], contentModel: "printables" },
  audience: { primary: "parents", ageRange: "children", secondary: ["teachers"] },
  domains: ["education"], emotionalGoals: ["playful"], requiredVisualSignals: ["friendly"], forbiddenVisualSignals: ["corporate"], explicitConstraints: [], ambiguities: [], confidence: 0.9,
});
const direction = CreativeDirectionSchema.parse({
  schemaVersion: "creative-direction/1.0", mode: "cream", visualArchetype: "illustrated_creative_play", emotionalTone: ["playful"],
  palette: { background: "#FFF8E8", surface: "#FFFFFF", surfaceAlt: "#F5E6C8", foreground: "#302A24", foregroundMuted: "#6B625A", accent: "#7C3AED", accentInk: "#FFFFFF", border: "#D8C7AB" },
  typography: { display: "rounded_playful", body: "friendly_high_legibility", mono: null, scale: "balanced" }, geometry: { radius: "soft", radiusScale: 1, spacingScale: 1, density: "low_medium" },
  imagery: { strategy: "illustration_first", artDirection: "hand_drawn", subjects: ["friendly_animals"], avoid: ["photorealism"] }, iconography: { style: "rounded_outline", strokeWeight: "medium", cornerStyle: "round" }, componentTreatment: { cards: "soft_bordered", buttons: "rounded_filled", navigation: "simple", sections: "airy" }, requiredVisualSignals: ["playful"], forbiddenVisualSignals: ["corporate"],
});
const inventory = SkeletonInventorySchema.parse({
  schemaVersion: "skeleton-inventory/1.0", templateId: "color-base", availableTokens: [], styleHooks: [],
  assetSlots: [{ slotIndex: 0, kind: "image", role: "hero", currentAlt: "Abstract artwork", replaceable: true }, { slotIndex: 1, kind: "image", role: "card", currentAlt: "Crayon card", replaceable: true }],
  structuralFingerprint: `sha256:${"a".repeat(64)}`,
});
const plan = SkeletonAdaptationPlanSchema.parse({
  schemaVersion: "skeleton-adaptation-plan/1.0", tokens: {}, cssOverride: [],
  assets: [{ slotIndex: 1, action: "replace", mediaType: "illustration", query: "crayons", alt: "Pastel crayons", required: false }, { slotIndex: 0, action: "replace", mediaType: "illustration", query: "friendly animals", alt: "Friendly animals ready to color", required: true }],
});
const assetPlan = { assets: plan.assets };

describe("buildAssetIntents", () => {
  it("produces stable slot ordering and deterministic role defaults", () => {
    expect(buildAssetIntents({ intent, direction, inventory, plan: assetPlan })).toEqual([
      expect.objectContaining({ slotIndex: 0, role: "hero", required: true, identityBearing: true, mediaType: "illustration", aspectRatio: "16:9", focalPoint: "center", domains: ["education"], audiences: ["parents", "teachers", "children"] }),
      expect.objectContaining({ slotIndex: 1, role: "card", required: false, identityBearing: false, mediaType: "illustration", aspectRatio: "1:1", focalPoint: "center" }),
    ]);
  });

  it("bounds subjects and combines validated directional signals", () => {
    const [hero] = buildAssetIntents({ intent, direction, inventory, plan: assetPlan });
    expect(hero.subjects).toEqual(["friendly_animals", "friendly", "animals"]);
    expect(hero.requiredSignals).toEqual(["friendly", "playful"]);
    expect(hero.forbiddenSignals).toEqual(["corporate", "photorealism"]);
  });

  it("omits keep instructions only for explicitly verified originals", () => {
    const keepPlan: Pick<SkeletonAdaptationPlan, "assets"> = { assets: [{ slotIndex: 1, action: "keep", mediaType: "illustration", query: null, alt: null, required: false }] };
    expect(buildAssetIntents({ intent, direction, inventory, plan: keepPlan })).toHaveLength(1);
    expect(buildAssetIntents({ intent, direction, inventory, plan: keepPlan, originalProvenance: new Map([[1, { source: "curated", slotIndex: 1, assetId: "verified-original", url: "https://images.openlen.com/verified.webp", mimeType: "image/webp", checksum: `sha256:${"b".repeat(64)}`, width: 400, height: 400, domainMatch: true, audienceMatch: true, styleMatch: true, provenance: { catalogVersion: "openlen-images-1", license: "openlen_catalog" } }]]) })).toEqual([]);
  });

  it("fails closed when a plan refers to an unavailable or nonreplaceable slot", () => {
    const absent = { assets: [{ ...plan.assets[0], slotIndex: 99 }] };
    expect(() => buildAssetIntents({ intent, direction, inventory, plan: absent })).toThrow(new AssetIntentError("asset_slot_unavailable", 99));
    const lockedInventory = SkeletonInventorySchema.parse({ ...inventory, assetSlots: [{ ...inventory.assetSlots[0], replaceable: false }] });
    expect(() => buildAssetIntents({ intent, direction, inventory: lockedInventory, plan: { assets: [{ ...plan.assets[1], slotIndex: 0 }] } })).toThrow(new AssetIntentError("asset_slot_unavailable", 0));
  });

  it("rejects unvalidated asset-instruction subsets", () => {
    const invalidPlans = [
      { assets: [{ ...plan.assets[0], action: "generate" }] },
      { assets: [plan.assets[0], plan.assets[0]] },
      { assets: Array.from({ length: 13 }, () => plan.assets[0]) },
      { assets: [{ ...plan.assets[0], privateHtml: "<main>secret</main>" }] },
      { assets: [plan.assets[0]], privateHtml: "<main>secret</main>" },
      { assets: [{ ...plan.assets[0], action: "keep", query: "crayons", alt: "Pastel crayons" }] },
    ];
    invalidPlans.forEach((invalidPlan) => {
      expect(() => buildAssetIntents({ intent, direction, inventory, plan: invalidPlan as typeof plan })).toThrow();
    });
  });
});
