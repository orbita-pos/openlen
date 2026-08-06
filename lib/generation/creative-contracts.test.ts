import { describe, expect, it } from "vitest";
import {
  CreativeDirectionSchema,
  SkeletonAdaptationPlanSchema,
  SkeletonCreativeResponseSchema,
  SkeletonInventorySchema,
} from "@/lib/generation/creative-contracts";
import { COLORING_DIRECTION, COLORING_PLAN, COLORING_TEMPLATE_METADATA } from "@/lib/generation/creative-fixtures.test-support";

describe("creative contracts", () => {
  it("parses the shared coloring direction", () => {
    expect(CreativeDirectionSchema.parse(COLORING_DIRECTION)).toEqual(COLORING_DIRECTION);
  });

  it("rejects unsupported direction values and unknown keys", () => {
    expect(() => CreativeDirectionSchema.parse({ ...COLORING_DIRECTION, extra: true })).toThrow();
    expect(() => CreativeDirectionSchema.parse({ ...COLORING_DIRECTION, palette: { ...COLORING_DIRECTION.palette, accent: "pink" } })).toThrow();
    expect(() => CreativeDirectionSchema.parse({ ...COLORING_DIRECTION, requiredVisualSignals: Array(13).fill("playful") })).toThrow();
  });

  it("validates a restrictive skeleton inventory", () => {
    expect(SkeletonInventorySchema.parse({ schemaVersion: "skeleton-inventory/1.0", ...COLORING_TEMPLATE_METADATA })).toMatchObject({ templateId: "coloring-template" });
    expect(() => SkeletonInventorySchema.parse({ schemaVersion: "skeleton-inventory/1.0", ...COLORING_TEMPLATE_METADATA, styleHooks: [{ ...COLORING_TEMPLATE_METADATA.styleHooks[0], id: "Bad Hook" }] })).toThrow();
  });

  it("rejects unsafe adaptation plans", () => {
    expect(SkeletonAdaptationPlanSchema.parse(COLORING_PLAN)).toEqual(COLORING_PLAN);
    expect(() => SkeletonAdaptationPlanSchema.parse({ schemaVersion: "skeleton-adaptation-plan/1.0", tokens: { "--evil": "red" }, cssOverride: [], assets: [] })).toThrow();
    expect(() => SkeletonAdaptationPlanSchema.parse({ ...COLORING_PLAN, assets: [...COLORING_PLAN.assets, { ...COLORING_PLAN.assets[0] }] })).toThrow();
    expect(() => SkeletonAdaptationPlanSchema.parse({ ...COLORING_PLAN, cssOverride: [{ hookId: "Bad Hook", declarations: {} }] })).toThrow();
  });

  it("accepts each approved incompatibility reason and rejects invalid versions", () => {
    for (const reasonCode of ["cannot_remove_forbidden_signal", "cannot_add_required_signal", "asset_slot_unavailable", "hook_property_not_allowed"]) {
      expect(SkeletonCreativeResponseSchema.parse({ schemaVersion: "skeleton-creative-response/1.0", status: "incompatible", reasonCode })).toMatchObject({ status: "incompatible" });
    }
    expect(() => SkeletonCreativeResponseSchema.parse({ schemaVersion: "skeleton-creative-response/9.0", status: "incompatible", reasonCode: "cannot_remove_forbidden_signal" })).toThrow();
  });
});
