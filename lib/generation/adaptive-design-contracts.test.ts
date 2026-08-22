import { describe, expect, it } from "vitest";

import { fireworksJsonSchema } from "@/lib/ai/fireworks-contracts";
import { COLORING_DIRECTION } from "./creative-fixtures.test-support";
import { CreativeDirectionSchema } from "./creative-contracts";
import {
  AdaptivePageDesignProgramSchema,
  createAdaptivePageDesignProgramSchema,
  createCandidateScoutResponseSchema,
  withRequiredLeadImage,
} from "./adaptive-design-contracts";

const candidates = [
  { candidateId: "hero-safe", ordinal: 0, role: "hero" },
  { candidateId: "features-safe", ordinal: 1, role: "features" },
] as const;

const decisions = [
  { ordinal: 0, action: "reuse", candidateId: "hero-safe", usefulTraits: ["cinematic"], rejectedTraits: [] },
  { ordinal: 1, action: "generate", candidateId: null, usefulTraits: [], rejectedTraits: ["generic"] },
] as const;

const coherentDirection = CreativeDirectionSchema.parse({
  ...COLORING_DIRECTION,
  requiredVisualSignals: ["cinematic", "tactile"],
  forbiddenVisualSignals: ["generic_saas"],
});

const valid = {
  schemaVersion: "adaptive-page-design/1.0",
  narrative: ["hero", "features"],
  direction: coherentDirection,
  decisions,
  rhythm: "cinematic",
  requiredSignals: ["cinematic", "tactile"],
  forbiddenSignals: ["generic_saas"],
  imageSlots: [{ slotIndex: 0, ordinal: 0, mediaType: "illustration", subject: "hand_drawn_characters", purpose: "hero_focal", required: true }],
} as const;

describe("adaptive design contracts", () => {
  it("accepts a bounded program without any catalog minimum", () => {
    const allGenerate = {
      ...valid,
      decisions: decisions.map((decision) => ({ ...decision, action: "generate" as const, candidateId: null })),
    };
    expect(createAdaptivePageDesignProgramSchema({
      requiredRoles: ["hero", "features"],
      retrievedCandidates: candidates,
    }).parse(allGenerate)).toEqual(allGenerate);
    expect(AdaptivePageDesignProgramSchema.safeParse({ ...allGenerate, minimumCatalogSections: 1 }).success).toBe(false);
  });

  it("rejects unknown keys, duplicate ordinals or candidate IDs, and invalid action references", () => {
    const schema = createAdaptivePageDesignProgramSchema({
      requiredRoles: ["hero", "features"],
      retrievedCandidates: candidates,
    });
    const invalid = [
      { ...valid, html: "<section>raw</section>" },
      { ...valid, decisions: [{ ...decisions[0] }, { ...decisions[1], ordinal: 0 }] },
      { ...valid, decisions: [{ ...decisions[0] }, { ...decisions[1], action: "rebuild", candidateId: "hero-safe" }] },
      { ...valid, decisions: [{ ...decisions[0], candidateId: null }, decisions[1]] },
      { ...valid, decisions: [decisions[0], { ...decisions[1], candidateId: "features-safe" }] },
      { ...valid, decisions: [{ ...decisions[0], candidateId: "outside-set" }, decisions[1]] },
    ];
    invalid.forEach((value) => expect(schema.safeParse(value).success).toBe(false));
  });

  it("rejects missing required roles, raw URL/HTML/CSS/copy-shaped strings, and overlong lists", () => {
    const schema = createAdaptivePageDesignProgramSchema({
      requiredRoles: ["hero", "features"],
      retrievedCandidates: candidates,
    });
    const invalid = [
      { ...valid, narrative: ["hero"] },
      { ...valid, requiredSignals: ["https://private.invalid/a"] },
      { ...valid, forbiddenSignals: ["<style>.x{color:red}</style>"] },
      { ...valid, imageSlots: [{ ...valid.imageSlots[0], subject: "literal marketing copy" }] },
      { ...valid, requiredSignals: Array.from({ length: 13 }, (_, index) => `signal_${index}`) },
      { ...valid, imageSlots: Array.from({ length: 13 }, (_, index) => ({ ...valid.imageSlots[0], slotIndex: index })) },
      { ...valid, decisions: [{ ...decisions[0], usefulTraits: Array.from({ length: 9 }, (_, index) => `trait_${index}`) }, decisions[1]] },
    ];
    invalid.forEach((value) => expect(schema.safeParse(value).success).toBe(false));
  });

  it("binds every Qwen decision to its required role and retrieved candidate set", () => {
    const schema = createCandidateScoutResponseSchema({
      requiredRoles: ["hero", "features"],
      retrievedCandidates: candidates,
    });
    const allGenerate = {
      schemaVersion: "adaptive-candidate-decisions/1.0",
      decisions: [
        { ordinal: 0, action: "generate", candidateId: null, usefulTraits: [], rejectedTraits: [] },
        { ordinal: 1, action: "generate", candidateId: null, usefulTraits: [], rejectedTraits: [] },
      ],
    } as const;
    expect(schema.parse(allGenerate)).toEqual(allGenerate);
    expect(schema.safeParse({ ...allGenerate, decisions: allGenerate.decisions.slice(0, 1) }).success).toBe(false);
  });

  it("normalizes equivalent Qwen arrays or objects by ordinal and rejects ambiguity", () => {
    const schema = createCandidateScoutResponseSchema({
      requiredRoles: ["hero", "features"],
      retrievedCandidates: candidates,
    });
    const hero = { ordinal: 0, action: "reuse", candidateId: "hero-safe", usefulTraits: ["cinematic"], rejectedTraits: [] };
    const features = { ordinal: 1, action: "generate", candidateId: null, usefulTraits: [], rejectedTraits: ["generic"] };
    const canonical = { schemaVersion: "adaptive-candidate-decisions/1.0", decisions: [hero, features] };

    expect(schema.parse({ ...canonical, decisions: [features, hero] })).toEqual(canonical);
    expect(schema.parse({ ...canonical, decisions: { second: features, first: hero } })).toEqual(canonical);
    expect(schema.parse({
      decisions: {
        hero: { ordinal: 0, action: "reuse", candidateId: "hero-safe" },
        features: { ordinal: 1, action: "generate" },
      },
    })).toEqual({
      schemaVersion: "adaptive-candidate-decisions/1.0",
      decisions: [
        { ordinal: 0, action: "reuse", candidateId: "hero-safe", usefulTraits: [], rejectedTraits: [] },
        { ordinal: 1, action: "generate", candidateId: null, usefulTraits: [], rejectedTraits: [] },
      ],
    });
    expect(schema.safeParse({ ...canonical, decisions: [hero, { ...features, ordinal: 0 }] }).success).toBe(false);
    expect(schema.safeParse({ ...canonical, decisions: [hero, { ...features, ordinal: 9 }] }).success).toBe(false);
  });

  it("normalizes harmless Qwen trait labels without relaxing structural controls", () => {
    const schema = createCandidateScoutResponseSchema({
      requiredRoles: ["hero", "features"],
      retrievedCandidates: candidates,
    });
    const result = schema.parse({
      decisions: {
        hero: {
          ordinal: 0,
          action: "reuse",
          candidateId: "hero-safe",
          usefulTraits: ["Soft Rounded Shapes", "soft-rounded-shapes", "Café Crayón", "Playful"],
          rejectedTraits: ["Generic SaaS", "Corporate", "Dashboard", "Dense", "Cold", "Flat", "Muted", "Rigid", "Extra"],
        },
        features: {
          ordinal: 1,
          action: "generate",
          usefulTraits: [],
          rejectedTraits: [],
        },
      },
    });

    expect(result.decisions[0]).toEqual({
      ordinal: 0,
      action: "reuse",
      candidateId: "hero-safe",
      usefulTraits: ["cafe_crayon", "playful", "soft_rounded_shapes"],
      rejectedTraits: ["cold", "corporate", "dashboard", "dense", "extra", "flat", "generic_saas", "muted"],
    });
    for (const unsafeTrait of ["<script>alert(1)</script>", "https://private.invalid/trait", "javascript:alert(1)"]) {
      expect(schema.safeParse({
        decisions: {
          hero: { ordinal: 0, action: "reuse", candidateId: "hero-safe", usefulTraits: [unsafeTrait], rejectedTraits: [] },
          features: { ordinal: 1, action: "generate", usefulTraits: [], rejectedTraits: [] },
        },
      }).success).toBe(false);
    }
    expect(schema.safeParse({
      decisions: {
        hero: { ordinal: 0, action: "reuse", candidateId: "outside-set", usefulTraits: ["Playful"], rejectedTraits: [] },
        features: { ordinal: 1, action: "generate", usefulTraits: [], rejectedTraits: [] },
      },
    }).success).toBe(false);
  });

  it("gives Qwen named positional decisions while preserving DeepSeek's proven page-plan schema", () => {
    const scoutJson = fireworksJsonSchema(createCandidateScoutResponseSchema({
      requiredRoles: ["hero", "features"],
      retrievedCandidates: candidates,
    })) as { properties: { decisions: { type?: string; required?: string[]; properties?: Record<string, unknown> } } };
    expect(scoutJson.properties.decisions).toMatchObject({
      type: "object",
      required: ["decision_0", "decision_1"],
      properties: { decision_0: expect.any(Object), decision_1: expect.any(Object) },
    });
    expect(JSON.stringify(scoutJson.properties.decisions.properties?.decision_0)).toContain('"const":0');
    expect(JSON.stringify(scoutJson.properties.decisions.properties?.decision_0)).toContain('"const":"hero-safe"');
    expect(JSON.stringify(scoutJson)).not.toMatch(/"(?:oneOf|prefixItems)"/);

    const pageJson = fireworksJsonSchema(createAdaptivePageDesignProgramSchema({
      requiredRoles: ["hero", "features"],
      retrievedCandidates: candidates,
      expectedDecisions: decisions.map((decision) => ({
        ...decision,
        usefulTraits: [...decision.usefulTraits],
        rejectedTraits: [...decision.rejectedTraits],
      })),
      initialRequiredSignals: ["cinematic", "tactile"],
      initialForbiddenSignals: ["generic_saas"],
    })) as { properties: { narrative: { minItems?: number; maxItems?: number; prefixItems?: unknown[] }; decisions: { minItems?: number; maxItems?: number; prefixItems?: unknown[] } } };
    expect(pageJson.properties.narrative).toMatchObject({ minItems: 2, maxItems: 2 });
    expect(pageJson.properties.narrative.prefixItems).toHaveLength(2);
    expect(pageJson.properties.decisions).toMatchObject({ minItems: 2, maxItems: 2 });
    expect(pageJson.properties.decisions.prefixItems).toHaveLength(2);
    expect(JSON.stringify(pageJson.properties.decisions.prefixItems?.[0])).toContain('"const":"reuse"');
    expect(JSON.stringify(pageJson.properties.decisions.prefixItems?.[1])).toContain('"const":"generate"');
  });

  it("canonicalizes equivalent DeepSeek decision maps, signal sets, and image-slot order", () => {
    const schema = createAdaptivePageDesignProgramSchema({
      requiredRoles: ["hero", "features"],
      retrievedCandidates: candidates,
      expectedDecisions: decisions.map((decision) => ({
        ...decision,
        usefulTraits: [...decision.usefulTraits],
        rejectedTraits: [...decision.rejectedTraits],
      })),
      initialRequiredSignals: ["cinematic", "tactile"],
      initialForbiddenSignals: ["generic_saas"],
    });
    const secondSlot = { slotIndex: 1, ordinal: 1, mediaType: "texture", subject: "paper_grain", purpose: "section_depth", required: false } as const;
    const equivalent = {
      ...valid,
      decisions: { second: decisions[1], first: decisions[0] },
      requiredSignals: ["tactile", "cinematic", "tactile"],
      forbiddenSignals: ["generic_saas", "generic_saas"],
      direction: {
        ...coherentDirection,
        requiredVisualSignals: ["tactile", "cinematic", "cinematic"],
        forbiddenVisualSignals: ["generic_saas", "generic_saas"],
      },
      imageSlots: [secondSlot, valid.imageSlots[0]],
    };

    expect(schema.parse(equivalent)).toEqual({
      ...valid,
      decisions: decisions.map((decision) => ({
        ...decision,
        usefulTraits: [...decision.usefulTraits],
        rejectedTraits: [...decision.rejectedTraits],
      })),
      imageSlots: [valid.imageSlots[0], secondSlot],
    });
    expect(schema.safeParse({ ...equivalent, decisions: { first: decisions[0], duplicate: decisions[0] } }).success).toBe(false);
  });

  it("rejects traits claimed as both useful and rejected", () => {
    expect(AdaptivePageDesignProgramSchema.safeParse({
      ...valid,
      decisions: [{ ...decisions[0], rejectedTraits: ["cinematic"] }, decisions[1]],
    }).success).toBe(false);
  });

  it("keeps direction and program signal sets coherent with canonical initial requirements", () => {
    const schema = createAdaptivePageDesignProgramSchema({
      requiredRoles: ["hero", "features"],
      retrievedCandidates: candidates,
      initialRequiredSignals: ["tactile", "cinematic"],
      initialForbiddenSignals: ["generic_saas"],
    } as never);
    expect(schema.safeParse(valid).success).toBe(true);
    const contradictions = [
      { ...valid, requiredSignals: ["cinematic"] },
      { ...valid, requiredSignals: ["cinematic", "generic_saas", "tactile"], forbiddenSignals: [] },
      { ...valid, forbiddenSignals: ["cinematic", "generic_saas"], requiredSignals: ["tactile"] },
      { ...valid, direction: { ...coherentDirection, requiredVisualSignals: ["cinematic", "generic_saas", "tactile"], forbiddenVisualSignals: [] } },
      { ...valid, direction: { ...coherentDirection, requiredVisualSignals: ["tactile"], forbiddenVisualSignals: ["cinematic", "generic_saas"] } },
    ];
    contradictions.forEach((value) => expect(schema.safeParse(value).success).toBe(false));
    expect(schema.safeParse({ ...valid, direction: { ...coherentDirection, requiredVisualSignals: ["tactile", "cinematic"] } }).success).toBe(true);
  });
});

describe("withRequiredLeadImage", () => {
  const base = {
    schemaVersion: "adaptive-page-design/1.0" as const,
    narrative: ["hero", "features"],
    decisions: [
      { ordinal: 0, action: "generate" as const, candidateId: null, usefulTraits: [], rejectedTraits: [] },
      { ordinal: 1, action: "generate" as const, candidateId: null, usefulTraits: [], rejectedTraits: [] },
    ],
    rhythm: "playful" as const,
  };
  const slot = (over: Record<string, unknown>) => ({ slotIndex: 0, ordinal: 0, mediaType: "photo" as const, subject: "children_painting", purpose: "hero_identity", required: false, ...over });

  it("promotes an optional lead image so sections must place it and generation may fall back on it", () => {
    const promoted = withRequiredLeadImage({ ...base, imageSlots: [slot({}), slot({ slotIndex: 1, ordinal: 1 })] });
    expect(promoted.imageSlots.map((entry) => entry.required)).toEqual([true, false]);
  });

  it("leaves a plan that already requires a lead image untouched", () => {
    const program = { ...base, imageSlots: [slot({ required: true }), slot({ slotIndex: 1, required: false })] };
    expect(withRequiredLeadImage(program)).toBe(program);
  });

  it("cannot invent a lead image when the plan offered none", () => {
    const program = { ...base, imageSlots: [slot({ slotIndex: 1, ordinal: 1 })] };
    expect(withRequiredLeadImage(program)).toBe(program);
    expect(withRequiredLeadImage({ ...base, imageSlots: [] }).imageSlots).toEqual([]);
  });
});
