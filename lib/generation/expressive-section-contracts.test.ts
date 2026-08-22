import { describe, expect, it } from "vitest";

import {
  ExpressiveSectionProgramSchema,
  SectionDecisionProvenanceSchema,
  validateExpressiveSectionProgram,
} from "./expressive-section-contracts";

const PROVENANCE = {
  schemaVersion: "section-decision-provenance/1.0",
  action: "generate",
  candidateId: null,
  sourceTemplateId: null,
  sourceBandOrdinal: null,
  sourceContentHash: null,
  sourceStructuralFingerprint: null,
  usefulTraits: [],
} as const;

function copy(id: string, copyKey = `copy.${id}`) {
  return {
    kind: "copy" as const,
    id,
    variant: "body" as const,
    copyKey,
    tone: "default" as const,
    size: "md" as const,
    color: "ink" as const,
    align: "start" as const,
  };
}

function layout(id: string, children: readonly unknown[]) {
  return {
    kind: "layout" as const,
    id,
    preset: "stack" as const,
    children,
    gap: "md" as const,
    padding: "md" as const,
    width: "content" as const,
    align: "stretch" as const,
    justify: "start" as const,
    columns: "one" as const,
    color: "surface" as const,
    radius: "md" as const,
    border: "none" as const,
    transform: "none" as const,
    blend: "normal" as const,
  };
}

function program(root: unknown = layout("root", [copy("title")])) {
  return {
    schemaVersion: "expressive-section-program/1.0",
    role: "hero",
    root,
    responsive: { mobile: [] },
    motion: [],
  };
}

describe("expressive section contracts", () => {
  it("accepts a strict v1 program and contextual allowlists", () => {
    const input = program();
    expect(ExpressiveSectionProgramSchema.parse(input)).toEqual(input);
    expect(validateExpressiveSectionProgram(input, {
      allowedCopyKeys: ["copy.title"],
      allowedAssetSlots: [],
    })).toMatchObject({ ok: true, program: input });
    expect(SectionDecisionProvenanceSchema.parse(PROVENANCE)).toEqual(PROVENANCE);
  });

  it("rejects depth above five, more than 64 nodes, and more than 12 media nodes", () => {
    const depthSix = layout("d1", [layout("d2", [layout("d3", [layout("d4", [layout("d5", [copy("d6")])])])])]);
    expect(ExpressiveSectionProgramSchema.safeParse(program(depthSix)).success).toBe(false);

    const sixtyFive = layout("root", Array.from({ length: 64 }, (_, index) => copy(`n${index}`)));
    expect(ExpressiveSectionProgramSchema.safeParse(program(sixtyFive)).success).toBe(false);

    const media = Array.from({ length: 13 }, (_, slotIndex) => ({
      kind: "media" as const,
      id: `media${slotIndex}`,
      slotIndex,
      aspect: "landscape" as const,
      fit: "cover" as const,
      treatment: "plain" as const,
      radius: "md" as const,
      transform: "none" as const,
    }));
    expect(ExpressiveSectionProgramSchema.safeParse(program(layout("root", media))).success).toBe(false);
  });

  it("rejects duplicate IDs, repeated media slots, shared recursion, and invalid mobile targets", () => {
    expect(ExpressiveSectionProgramSchema.safeParse(program(layout("root", [copy("same"), copy("same")]))).success).toBe(false);
    const duplicatedSlot = layout("root", [
      { kind: "media", id: "m1", slotIndex: 1, aspect: "square", fit: "cover", treatment: "plain", radius: "sm", transform: "none" },
      { kind: "media", id: "m2", slotIndex: 1, aspect: "portrait", fit: "contain", treatment: "framed", radius: "lg", transform: "tilt_left" },
    ]);
    expect(ExpressiveSectionProgramSchema.safeParse(program(duplicatedSlot)).success).toBe(false);

    const shared = copy("shared");
    expect(ExpressiveSectionProgramSchema.safeParse(program(layout("root", [shared, shared]))).success).toBe(false);
    const cyclic = layout("cycle", []) as ReturnType<typeof layout> & { children: unknown[] };
    cyclic.children.push(cyclic);
    expect(() => ExpressiveSectionProgramSchema.safeParse(program(cyclic))).not.toThrow();
    expect(ExpressiveSectionProgramSchema.safeParse(program(cyclic)).success).toBe(false);

    expect(ExpressiveSectionProgramSchema.safeParse({
      ...program(),
      responsive: { mobile: [{ nodeId: "missing", preset: "grid", columns: "two", gap: "sm", padding: "sm", hidden: false }] },
    }).success).toBe(false);
    expect(ExpressiveSectionProgramSchema.safeParse({
      ...program(),
      responsive: { mobile: [{ nodeId: "title", preset: "grid", columns: "two", gap: "sm", padding: "sm", hidden: false }] },
    }).success).toBe(false);
  });

  it("rejects literal copy, implementation syntax, unknown enums, and extreme dimensions", () => {
    const unsafeMutations = [
      { ...copy("title"), text: "literal user copy" },
      { ...copy("title"), html: "<script>alert(1)</script>" },
      { ...copy("title"), css: ".private{position:fixed}" },
      { ...copy("title"), selector: "body" },
      { ...copy("title"), url: "https://private.invalid/a" },
      { ...copy("title"), script: "alert(1)" },
      { ...copy("title"), event: "onclick" },
      { ...copy("title"), import: "evil-package" },
      { ...copy("title"), widthPx: 999999 },
      { ...copy("title"), size: "999vw" },
      { ...copy("title"), color: "#ff00ff" },
      { ...copy("title"), transform: "translateX(-999999px)" },
    ];
    for (const mutation of unsafeMutations) {
      expect(ExpressiveSectionProgramSchema.safeParse(program(layout("root", [mutation]))).success).toBe(false);
    }
    expect(ExpressiveSectionProgramSchema.safeParse({
      ...program(),
      motion: [{ nodeId: "title", preset: "eval_js", intensity: "subtle", delay: "none" }],
    }).success).toBe(false);
  });

  it("enforces exact copy and asset allowlists after structural parsing", () => {
    const input = program(layout("root", [
      copy("title", "hero.title"),
      { kind: "media", id: "visual", slotIndex: 4, aspect: "cinematic", fit: "cover", treatment: "bleed", radius: "none", transform: "scale_up" },
    ]));
    expect(validateExpressiveSectionProgram(input, { allowedCopyKeys: ["hero.title"], allowedAssetSlots: [4] })).toMatchObject({ ok: true });
    expect(validateExpressiveSectionProgram(input, { allowedCopyKeys: [], allowedAssetSlots: [4] })).toEqual({ ok: false, code: "copy_key_not_allowed" });
    expect(validateExpressiveSectionProgram(input, { allowedCopyKeys: ["hero.title"], allowedAssetSlots: [] })).toEqual({ ok: false, code: "asset_slot_not_allowed" });
  });

  it("binds rebuild provenance and forbids donor material on generate", () => {
    const rebuild = {
      ...PROVENANCE,
      action: "rebuild",
      candidateId: "hero-candidate",
      sourceTemplateId: "donor-one",
      sourceBandOrdinal: 2,
      sourceContentHash: "a".repeat(12),
      sourceStructuralFingerprint: `sha256:${"b".repeat(64)}`,
      usefulTraits: ["editorial", "layered"],
    };
    expect(SectionDecisionProvenanceSchema.safeParse(rebuild).success).toBe(true);
    expect(SectionDecisionProvenanceSchema.safeParse({ ...PROVENANCE, sourceTemplateId: "private-donor" }).success).toBe(false);
    expect(SectionDecisionProvenanceSchema.safeParse({ ...rebuild, candidateId: null }).success).toBe(false);
  });
});
