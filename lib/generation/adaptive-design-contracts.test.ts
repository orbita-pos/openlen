import { describe, expect, it } from "vitest";

import { fireworksJsonSchema } from "@/lib/ai/fireworks-contracts";
import { COLORING_DIRECTION } from "./creative-fixtures.test-support";
import { CreativeDirectionSchema } from "./creative-contracts";
import {
  AdaptivePageDesignProgramSchema,
  createAdaptivePageDesignProgramSchema,
  createCandidateScoutResponseSchema,
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

  it("exposes contextual scout and page-plan invariants with Fireworks-supported anyOf schemas", () => {
    const scoutJson = fireworksJsonSchema(createCandidateScoutResponseSchema({
      requiredRoles: ["hero", "features"],
      retrievedCandidates: candidates,
    })) as { properties: { decisions: { items?: { anyOf?: unknown[] } } } };
    expect(scoutJson.properties.decisions.items?.anyOf).toHaveLength(2);
    expect(JSON.stringify(scoutJson.properties.decisions.items?.anyOf?.[0])).toContain('"const":0');
    expect(JSON.stringify(scoutJson.properties.decisions.items?.anyOf?.[0])).toContain('"const":"hero-safe"');

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
    })) as { properties: { narrative: { items?: { anyOf?: unknown[] } }; decisions: { items?: { anyOf?: unknown[] } } } };
    expect(pageJson.properties.narrative.items?.anyOf).toHaveLength(2);
    expect(pageJson.properties.decisions.items?.anyOf).toHaveLength(2);
    expect(JSON.stringify(pageJson.properties.decisions.items?.anyOf?.[0])).toContain('"const":"reuse"');
    expect(JSON.stringify(pageJson.properties.decisions.items?.anyOf?.[1])).toContain('"const":"generate"');
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
      { ...valid, direction: { ...coherentDirection, requiredVisualSignals: ["tactile", "cinematic"] } },
    ];
    contradictions.forEach((value) => expect(schema.safeParse(value).success).toBe(false));
  });
});
