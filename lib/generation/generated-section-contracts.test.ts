import { describe, expect, it } from "vitest";

import {
  ExpressiveSectionProgramSchema,
  GeneratedSectionSpecSchema,
  renderGeneratedSectionDraft,
  validateGeneratedSectionReferences,
} from "./generated-section-contracts";

const SPEC = {
  schemaVersion: "generated-section-spec/1.0",
  role: "activities",
  layout: "grid",
  blocks: [
    { kind: "heading", copyKey: "activities.title" },
    { kind: "cards", copyKeys: ["activities.one", "activities.two"] },
    { kind: "media", slotIndex: 2 },
  ],
  geometry: { density: "balanced", emphasis: "balanced" },
} as const;
const PARSED_SPEC = GeneratedSectionSpecSchema.parse(SPEC);

describe("generated section contracts", () => {
  it("publishes the expressive v1 AST as the generated-section contract", () => {
    expect(ExpressiveSectionProgramSchema.safeParse({
      schemaVersion: "expressive-section-program/1.0",
      role: "hero",
      root: { kind: "copy", id: "title", variant: "heading", copyKey: "hero.title", tone: "strong", size: "display", color: "ink", align: "start" },
      responsive: { mobile: [] },
      motion: [],
    }).success).toBe(true);
  });

  it("accepts only the closed scalar spec and rejects model-authored implementation", () => {
    expect(GeneratedSectionSpecSchema.parse(SPEC)).toEqual(SPEC);
    for (const extra of [
      { html: "<section>bad</section>" }, { css: ".x{}" }, { js: "alert(1)" },
      { url: "https://private.invalid" }, { text: "invented copy" },
    ]) expect(GeneratedSectionSpecSchema.safeParse({ ...SPEC, ...extra }).success).toBe(false);
    expect(GeneratedSectionSpecSchema.safeParse({ ...SPEC, layout: "dashboard" }).success).toBe(false);
    expect(GeneratedSectionSpecSchema.safeParse({ ...SPEC, blocks: [...SPEC.blocks, { kind: "html", value: "<b>x</b>" }] }).success).toBe(false);
  });

  it("requires exact supplied copy keys and unique supplied asset slots", () => {
    expect(validateGeneratedSectionReferences(SPEC, {
      copyKeys: ["activities.title", "activities.one", "activities.two"], assetSlots: [2],
    })).toBe(true);
    expect(validateGeneratedSectionReferences(SPEC, {
      copyKeys: ["activities.title", "activities.one"], assetSlots: [2],
    })).toBe(false);
    expect(validateGeneratedSectionReferences({ ...SPEC, blocks: [...SPEC.blocks, { kind: "media", slotIndex: 2 }] }, {
      copyKeys: ["activities.title", "activities.one", "activities.two"], assetSlots: [2],
    })).toBe(false);
  });

  it("renders escaped copy and repository-owned markup without interpolating model syntax", () => {
    const result = renderGeneratedSectionDraft(PARSED_SPEC, {
      "activities.title": "Crear <script>alert(1)</script>",
      "activities.one": "Pinta & juega",
      "activities.two": "Imagina",
    });
    expect(result.html).toContain("&lt;script&gt;");
    expect(result.html).not.toContain("<script>");
    expect(result.html).toContain('data-openlen-asset-slot="2"');
    expect(result.html).toContain('data-openlen-generated="generated-section-spec/1.0"');
    expect(result.html).not.toContain("activities.title");
  });
});
