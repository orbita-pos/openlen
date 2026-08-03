import { describe, expect, it } from "vitest";
import {
  TemplateVisualMetadataSchema,
  parseTemplateVisualMetadata,
} from "./visual-metadata";

const REVIEWED = {
  schemaVersion: "template-visual-metadata/1.0",
  domains: ["children_entertainment"],
  audiences: ["children", "parents"],
  ageRanges: ["5_10"],
  emotionalRegisters: ["playful", "magical"],
  visualArchetypes: ["illustrated_creative_play"],
  visualSignals: ["child_friendly_illustration", "drawing_tool_motif"],
  layoutTraits: ["image_forward", "low_density"],
  requiredAssetTypes: ["illustration"],
  negativeTags: ["enterprise_b2b"],
  supportedSiteTypes: ["content_platform"],
  supportedSectionRoles: ["hero", "coloring_gallery", "activities", "stories", "footer"],
  themeability: "high",
  identityStrength: "high",
  reviewStatus: "reviewed",
} as const;

describe("TemplateVisualMetadataSchema", () => {
  it("accepts reviewed metadata", () => {
    expect(TemplateVisualMetadataSchema.parse(REVIEWED)).toEqual(REVIEWED);
  });

  it("rejects prose tags and unknown versions", () => {
    expect(TemplateVisualMetadataSchema.safeParse({ ...REVIEWED, domains: ["Kids Website"] }).success).toBe(false);
    expect(TemplateVisualMetadataSchema.safeParse({ ...REVIEWED, schemaVersion: "v2" }).success).toBe(false);
  });

  it("returns null for malformed DB metadata", () => {
    expect(parseTemplateVisualMetadata({ domains: ["saas"] })).toBeNull();
  });
});
