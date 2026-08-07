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

  it("rejects duplicate inventory tokens, hook properties, hook IDs, and asset slots", () => {
    const inventory = { schemaVersion: "skeleton-inventory/1.0", ...COLORING_TEMPLATE_METADATA } as const;
    expect(() => SkeletonInventorySchema.parse({ ...inventory, availableTokens: ["--ol-bg", "--ol-bg"] })).toThrow();
    expect(() => SkeletonInventorySchema.parse({ ...inventory, styleHooks: [{ ...inventory.styleHooks[0], allowedProperties: ["color", "color"] }] })).toThrow();
    expect(() => SkeletonInventorySchema.parse({ ...inventory, styleHooks: [inventory.styleHooks[0], { ...inventory.styleHooks[0], selector: ".hero-copy" }] })).toThrow();
    expect(() => SkeletonInventorySchema.parse({ ...inventory, assetSlots: [inventory.assetSlots[0], { ...inventory.assetSlots[0], currentAlt: "Duplicate slot" }] })).toThrow();
  });

  it("rejects nested unknown fields and invalid inventory properties", () => {
    const inventory = { schemaVersion: "skeleton-inventory/1.0", ...COLORING_TEMPLATE_METADATA } as const;
    expect(() => CreativeDirectionSchema.parse({ ...COLORING_DIRECTION, palette: { ...COLORING_DIRECTION.palette, extra: true } })).toThrow();
    expect(() => SkeletonInventorySchema.parse({ ...inventory, styleHooks: [{ ...inventory.styleHooks[0], extra: true }] })).toThrow();
    expect(() => SkeletonInventorySchema.parse({ ...inventory, assetSlots: [{ ...inventory.assetSlots[0], extra: true }] })).toThrow();
    expect(() => SkeletonInventorySchema.parse({ ...inventory, styleHooks: [{ ...inventory.styleHooks[0], allowedProperties: ["position"] }] })).toThrow();
  });

  it("rejects unsafe adaptation plans", () => {
    expect(SkeletonAdaptationPlanSchema.parse(COLORING_PLAN)).toEqual(COLORING_PLAN);
    expect(() => SkeletonAdaptationPlanSchema.parse({ schemaVersion: "skeleton-adaptation-plan/1.0", tokens: { "--evil": "red" }, cssOverride: [], assets: [] })).toThrow();
    expect(() => SkeletonAdaptationPlanSchema.parse({ ...COLORING_PLAN, assets: [...COLORING_PLAN.assets, { ...COLORING_PLAN.assets[0] }] })).toThrow();
    expect(() => SkeletonAdaptationPlanSchema.parse({ ...COLORING_PLAN, cssOverride: [{ hookId: "Bad Hook", declarations: {} }] })).toThrow();
  });

  it("rejects model-facing markup, script schemes, URLs, and CSS payloads in asset text", () => {
    const asset = COLORING_PLAN.assets[0];
    for (const query of ["<script>alert(1)</script>", "javascript:alert(1)", "vbscript:msgbox(1)", "https://example.com/cat", "ftp://example.com/cat", "coloring cats { display: none; }"]) {
      expect(() => SkeletonAdaptationPlanSchema.parse({ ...COLORING_PLAN, assets: [{ ...asset, query }] })).toThrow();
    }
    for (const alt of ["<img src=x>", "data:text/html,bad", "mailto:bad@example.com", "www.example.com/cat", "friendly cats; position: fixed;"]) {
      expect(() => SkeletonAdaptationPlanSchema.parse({ ...COLORING_PLAN, assets: [{ ...asset, alt }] })).toThrow();
    }
    expect(SkeletonAdaptationPlanSchema.parse({ ...COLORING_PLAN, assets: [{ ...asset, query: "playful woodland animals; simple shapes for a children's coloring page", alt: "Smiling woodland animals; ready to color" }] })).toBeTruthy();
  });

  it("accepts only globally approved declaration keys and safe declaration values", () => {
    for (const key of ["position", "display", "content", "background-image", "<style>"]) {
      expect(() => SkeletonAdaptationPlanSchema.parse({ ...COLORING_PLAN, cssOverride: [{ hookId: "hero", declarations: { [key]: "none" } }] })).toThrow();
    }
    for (const value of ["<script>alert(1)</script>", "javascript:alert(1)", "vbscript:msgbox(1)", "url(https://example.com/x.png)", "url(ftp://example.com/x.png)", "red; position: fixed", "{ display: none }"]) {
      expect(() => SkeletonAdaptationPlanSchema.parse({ ...COLORING_PLAN, cssOverride: [{ hookId: "hero", declarations: { color: value } }] })).toThrow();
    }
    expect(SkeletonAdaptationPlanSchema.parse({ ...COLORING_PLAN, cssOverride: [{ hookId: "hero", declarations: { color: "#302A24", "text-align": "center", padding: "1rem" } }] })).toBeTruthy();
  });

  it("rejects duplicate adaptation hook IDs", () => {
    expect(() => SkeletonAdaptationPlanSchema.parse({ ...COLORING_PLAN, cssOverride: [COLORING_PLAN.cssOverride[0], { ...COLORING_PLAN.cssOverride[0] }] })).toThrow();
  });

  it("enforces keep and replace asset nullability and nested strictness", () => {
    const replacement = COLORING_PLAN.assets[0];
    expect(SkeletonAdaptationPlanSchema.parse({ ...COLORING_PLAN, assets: [{ ...replacement, action: "keep", query: null, alt: null }] })).toBeTruthy();
    expect(() => SkeletonAdaptationPlanSchema.parse({ ...COLORING_PLAN, assets: [{ ...replacement, action: "keep", query: replacement.query, alt: null }] })).toThrow();
    expect(() => SkeletonAdaptationPlanSchema.parse({ ...COLORING_PLAN, assets: [{ ...replacement, action: "keep", query: null, alt: replacement.alt }] })).toThrow();
    expect(() => SkeletonAdaptationPlanSchema.parse({ ...COLORING_PLAN, assets: [{ ...replacement, query: null }] })).toThrow();
    expect(() => SkeletonAdaptationPlanSchema.parse({ ...COLORING_PLAN, assets: [{ ...replacement, alt: null }] })).toThrow();
    expect(() => SkeletonAdaptationPlanSchema.parse({ ...COLORING_PLAN, assets: [{ ...replacement, extra: true }] })).toThrow();
    expect(() => SkeletonAdaptationPlanSchema.parse({ ...COLORING_PLAN, cssOverride: [{ ...COLORING_PLAN.cssOverride[0], extra: true }] })).toThrow();
  });

  it("enforces model-facing string and array limits", () => {
    const inventory = { schemaVersion: "skeleton-inventory/1.0", ...COLORING_TEMPLATE_METADATA } as const;
    const hook = inventory.styleHooks[0];
    const slot = inventory.assetSlots[0];
    const override = COLORING_PLAN.cssOverride[0];
    const asset = COLORING_PLAN.assets[0];
    expect(() => SkeletonInventorySchema.parse({ ...inventory, availableTokens: ["--ol-bg", "--ol-surface", "--ol-surface-2", "--ol-fg", "--ol-fg-muted", "--ol-fg-faint", "--ol-border", "--ol-border-strong", "--ol-accent", "--ol-accent-ink", "--ol-radius", "--ol-r-scale", "--ol-space-scale"] })).toThrow();
    expect(() => SkeletonInventorySchema.parse({ ...inventory, styleHooks: Array.from({ length: 13 }, (_, id) => ({ ...hook, id: `hook-${id}` })) })).toThrow();
    expect(() => SkeletonInventorySchema.parse({ ...inventory, styleHooks: [{ ...hook, allowedProperties: ["background-color", "color", "font-family", "border-color", "border-radius", "padding", "gap", "box-shadow", "text-align", "fill", "stroke", "stroke-width", "stroke-linecap"] }] })).toThrow();
    expect(() => SkeletonInventorySchema.parse({ ...inventory, assetSlots: Array.from({ length: 13 }, (_, slotIndex) => ({ ...slot, slotIndex })) })).toThrow();
    expect(() => SkeletonAdaptationPlanSchema.parse({ ...COLORING_PLAN, cssOverride: Array.from({ length: 13 }, (_, id) => ({ ...override, hookId: `hook-${id}` })) })).toThrow();
    expect(() => SkeletonAdaptationPlanSchema.parse({ ...COLORING_PLAN, assets: Array.from({ length: 13 }, (_, slotIndex) => ({ ...asset, slotIndex })) })).toThrow();
    expect(() => SkeletonAdaptationPlanSchema.parse({ ...COLORING_PLAN, assets: [{ ...asset, query: "q".repeat(181) }] })).toThrow();
    expect(() => SkeletonAdaptationPlanSchema.parse({ ...COLORING_PLAN, assets: [{ ...asset, alt: "a".repeat(241) }] })).toThrow();
    expect(() => SkeletonAdaptationPlanSchema.parse({ ...COLORING_PLAN, tokens: { "--ol-bg": "x".repeat(181) } })).toThrow();
    expect(() => SkeletonAdaptationPlanSchema.parse({ ...COLORING_PLAN, cssOverride: [{ ...override, declarations: { color: "x".repeat(181) } }] })).toThrow();
  });

  it("rejects invalid versions for every creative contract", () => {
    expect(() => CreativeDirectionSchema.parse({ ...COLORING_DIRECTION, schemaVersion: "creative-direction/2.0" })).toThrow();
    expect(() => SkeletonInventorySchema.parse({ schemaVersion: "skeleton-inventory/2.0", ...COLORING_TEMPLATE_METADATA })).toThrow();
    expect(() => SkeletonAdaptationPlanSchema.parse({ ...COLORING_PLAN, schemaVersion: "skeleton-adaptation-plan/2.0" })).toThrow();
  });

  it("accepts a complete ready response and rejects incompatible-only or unknown ready fields", () => {
    const ready = { schemaVersion: "skeleton-creative-response/1.0", status: "ready", direction: COLORING_DIRECTION, plan: COLORING_PLAN } as const;
    expect(SkeletonCreativeResponseSchema.parse(ready)).toEqual(ready);
    expect(() => SkeletonCreativeResponseSchema.parse({ ...ready, reasonCode: "cannot_remove_forbidden_signal" })).toThrow();
    expect(() => SkeletonCreativeResponseSchema.parse({ ...ready, extra: true })).toThrow();
  });

  it("accepts each approved incompatibility reason and rejects invalid versions", () => {
    for (const reasonCode of ["cannot_remove_forbidden_signal", "cannot_add_required_signal", "asset_slot_unavailable", "hook_property_not_allowed"]) {
      expect(SkeletonCreativeResponseSchema.parse({ schemaVersion: "skeleton-creative-response/1.0", status: "incompatible", reasonCode })).toMatchObject({ status: "incompatible" });
    }
    expect(() => SkeletonCreativeResponseSchema.parse({ schemaVersion: "skeleton-creative-response/9.0", status: "incompatible", reasonCode: "cannot_remove_forbidden_signal" })).toThrow();
  });
});
