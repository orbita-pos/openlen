import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { SectionPlanSchema } from "./section-composition-contracts";
import { CreativeDirectionSchema } from "./creative-contracts";
import { COLORING_DIRECTION } from "./creative-fixtures.test-support";
import { AI_HYBRID_NICHE_CASES } from "./ai-hybrid-niche-cohort";
import { IntentAnalysisSchema } from "./contracts";
import {
  buildSectionCompositionInventory,
  fetchVerifiedSectionFragments,
  resolveSectionPlan,
  SectionCompositionSelectionError,
} from "./section-inventory";
import type { SectionRecord } from "@/lib/sections/store";
import type { SectionMode, SectionStatus, SectionType } from "@/lib/sections/types";

const sha12 = (html: string) => createHash("sha256").update(html, "utf8").digest("hex").slice(0, 12);

function record(
  id: string,
  type: SectionType,
  html: string,
  opts: {
    status?: SectionStatus;
    mode?: SectionMode;
    radius?: string;
    needsJs?: boolean;
    hasPlaceholders?: boolean;
    storageKey?: string;
    contentHash?: string;
    name?: string;
    variantLabel?: string;
    manual?: boolean;
    sourceTemplateId?: string;
    sourceBandOrdinal?: number;
    negativeSignals?: Array<"dashboard" | "analytics" | "software_mockup">;
  } = {},
): SectionRecord {
  const hash = opts.contentHash ?? sha12(html);
  const sourceTemplateId = opts.sourceTemplateId ?? `donor-${id}`;
  return {
    id,
    type,
    name: opts.name ?? `<html hidden name ${id}>`,
    variantLabel: opts.variantLabel ?? `variant ${id}`,
    rootTag: "section",
    mode: opts.mode ?? "light",
    storageKey: opts.storageKey ?? `sections/${id}-${sha12(html)}.html`,
    storageUrl: `https://storage.invalid/${id}.html`,
    contentHash: hash,
    size: html.length,
    designTokens: opts.radius ? { "--radius": opts.radius } : null,
    fonts: null,
    needsJs: opts.needsJs ?? false,
    hasPlaceholders: opts.hasPlaceholders ?? false,
    thumbnailUrl: null,
    ...(opts.manual ? {} : {
      provenance: {
        schemaVersion: "derived-section-provenance/1.0",
        sourceTemplateId,
        sourceTemplateHash: "a".repeat(12),
        sourceBandOrdinal: opts.sourceBandOrdinal ?? 0,
        extractionVersion: "template-band-extractor/1.0",
        sourceHash: `sha256:${"a".repeat(64)}`,
        structuralFingerprint: `sha256:${createHash("sha256").update(id).digest("hex")}`,
      },
      derivedSemantics: {
        schemaVersion: "derived-section-semantics/1.0",
        role: type,
        layoutArchetypes: ["centered"],
        domains: ["children_creativity"],
        audiences: ["children"],
        moods: ["playful"],
        negativeSignals: opts.negativeSignals ?? [],
      },
    }),
    status: opts.status ?? "published",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    publishedAt: opts.status === "draft" ? null : new Date(0),
  };
}

const COLORING = AI_HYBRID_NICHE_CASES[0];
const CONTEXT = {
  intent: COLORING.intent,
  direction: COLORING.expectedCreativeDirection,
};
const LEGACY_CONTEXT = {
  intent: IntentAnalysisSchema.parse({
    ...COLORING.intent,
    forbiddenVisualSignals: [],
  }),
  direction: CreativeDirectionSchema.parse({
    ...COLORING.expectedCreativeDirection,
    forbiddenVisualSignals: [],
    imagery: { ...COLORING.expectedCreativeDirection.imagery, avoid: [] },
  }),
};

const HTML: Record<string, string> = {
  "hero-01": "<section data-sec=\"hero-01\"><h1>Hero</h1></section>",
  "features-01": "<section data-sec=\"features-01\"><h2>One</h2></section>",
  "features-02": "<section data-sec=\"features-02\"><h2>Two</h2></section>",
  "features-03": "<section data-sec=\"features-03\"><h2>Three</h2></section>",
};

function inventory() {
  return buildSectionCompositionInventory([
    record("features-03", "features", HTML["features-03"]),
    record("hero-01", "hero", HTML["hero-01"], { radius: "24px", hasPlaceholders: true }),
    record("features-01", "features", HTML["features-01"]),
    record("features-02", "features", HTML["features-02"]),
  ]);
}

function plan(inventoryHash: string) {
  return SectionPlanSchema.parse({
    schemaVersion: "section-plan/1.0",
    intentHash: `sha256:${"a".repeat(64)}`,
    inventoryHash,
    rows: [
      { ordinal: 0, requestedRole: "hero", componentType: "hero", compatibilityKind: "exact", compatibilityScore: 1, compatibilityRuleId: "section_component:exact:hero", required: true },
      { ordinal: 1, requestedRole: "minigames", componentType: "features", compatibilityKind: "structural", compatibilityScore: 0.85, compatibilityRuleId: "section_component:structural:minigames>features", required: true },
      { ordinal: 2, requestedRole: "stories", componentType: "features", compatibilityKind: "structural", compatibilityScore: 0.85, compatibilityRuleId: "section_component:structural:stories>features", required: true },
      { ordinal: 3, requestedRole: "activities", componentType: "features", compatibilityKind: "structural", compatibilityScore: 0.85, compatibilityRuleId: "section_component:structural:activities>features", required: true },
    ],
  });
}

describe("section composition inventory", () => {
  it("projects only published scalar metadata and hashes canonically", () => {
    const draft = record("gallery-draft", "gallery", "<section>draft</section>", { status: "draft", manual: true });
    const publishedA = record("hero-01", "hero", HTML["hero-01"], { radius: "24px", hasPlaceholders: true, manual: true });
    const publishedB = record("features-01", "features", HTML["features-01"], { manual: true });
    const first = buildSectionCompositionInventory([draft, publishedB, publishedA]);
    const second = buildSectionCompositionInventory([publishedA, draft, publishedB]);

    expect(first).toEqual(second);
    expect(first.entries.map((row) => row.id)).toEqual(["features-01", "hero-01"]);
    expect(first.entries[1]).toMatchObject({
      radiusBucket: "soft",
      density: "unknown",
      assetCapability: "replaceable",
      semanticProfile: {
        tags: ["analytics", "dashboard", "software_mockup"],
        source: "reviewed_override",
      },
    });
    expect(Object.keys(first.entries[0]).sort()).toEqual([
      "assetCapability", "contentHash", "density", "derivedSemantics", "id", "mode", "needsJs", "radiusBucket", "semanticProfile", "sourceBandOrdinal", "sourceKind", "sourceTemplateId", "structuralFingerprint", "type",
    ]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.entries)).toBe(true);
    expect(first.entries.every(Object.isFrozen)).toBe(true);
    expect(JSON.stringify(first)).not.toContain("storageUrl");
    expect(JSON.stringify(first)).not.toContain("<html");
  });

  it("binds provenance and trusted semantics into the inventory hash", () => {
    const first = record("hero-derived", "hero", "<section>hero</section>", { sourceTemplateId: "arcana", sourceBandOrdinal: 1 });
    const altered = record("hero-derived", "hero", "<section>hero</section>", { sourceTemplateId: "obra", sourceBandOrdinal: 1 });
    expect(buildSectionCompositionInventory([first]).hash).not.toBe(buildSectionCompositionInventory([altered]).hash);
  });

  it("rejects derived semantics whose role disagrees with the stored section type", () => {
    const mismatched = record("hero-derived", "hero", "<section>hero</section>");
    mismatched.derivedSemantics = { ...mismatched.derivedSemantics!, role: "pricing" };
    expect(() => buildSectionCompositionInventory([mismatched]))
      .toThrow(expect.objectContaining({ code: "section_inventory_stale" }));
  });

  it("selects repeatable distinct variants for repeated semantic roles", () => {
    const frozen = inventory();
    const first = resolveSectionPlan(plan(frozen.hash), frozen, LEGACY_CONTEXT);
    const second = resolveSectionPlan(plan(frozen.hash), frozen, LEGACY_CONTEXT);
    expect(first).toEqual(second);
    expect(first.map((row) => row.requestedRole)).toEqual(["hero", "minigames", "stories", "activities"]);
    expect(new Set(first.map((row) => row.sectionId)).size).toBe(4);
  });

  it("rejects a plan created against another frozen inventory", () => {
    const frozen = inventory();
    expect(() => resolveSectionPlan(plan(`sha256:${"b".repeat(64)}`), frozen, LEGACY_CONTEXT))
      .toThrow(expect.objectContaining({ code: "section_inventory_stale" }));
  });

  it("rejects every non-canonical published storage key as stale inventory", () => {
    const html = HTML["hero-01"];
    for (const storageKey of [
      `sections/other-${sha12(html)}.html`,
      `sections/hero-01-${"0".repeat(12)}.html`,
      `sections/../hero-01-${sha12(html)}.html`,
      `alternate/hero-01-${sha12(html)}.html`,
      `sections/hero-01-${sha12(html)}.html?query=1`,
    ]) {
      expect(() => buildSectionCompositionInventory([
        record("hero-01", "hero", html, { storageKey }),
      ])).toThrow(expect.objectContaining({ code: "section_inventory_stale" }));
    }
  });

  it("rejects malformed IDs and hashes even when their interpolated storage key matches", () => {
    const html = HTML["hero-01"];
    const validHash = sha12(html);
    const maliciousRecords = [
      record("a".repeat(129), "hero", html, {
        storageKey: `sections/${"a".repeat(129)}-${validHash}.html`,
      }),
      record("../hero", "hero", html, { storageKey: `sections/../hero-${validHash}.html` }),
      record("hero-01", "hero", html, {
        contentHash: `../${validHash}`,
        storageKey: `sections/hero-01-../${validHash}.html`,
      }),
      record("hero-01", "hero", html, {
        contentHash: validHash.toUpperCase(),
        storageKey: `sections/hero-01-${validHash.toUpperCase()}.html`,
      }),
    ];
    for (const malicious of maliciousRecords) {
      expect(() => buildSectionCompositionInventory([malicious]))
        .toThrow(expect.objectContaining({ code: "section_inventory_stale" }));
    }
  });

  it("never lets seeded variety outrank the creative-direction fit", () => {
    const frozen = buildSectionCompositionInventory([
      record("hero-best", "hero", "<section>best</section>", { radius: "10px" }),
      ...Array.from({ length: 7 }, (_, index) =>
        record(`hero-sharp-${index}`, "hero", `<section>sharp ${index}</section>`, { radius: "2px" })),
    ]);
    for (const digit of "0123456789abcdef") {
      const heroOnly = SectionPlanSchema.parse({
        schemaVersion: "section-plan/1.0",
        intentHash: `sha256:${digit.repeat(64)}`,
        inventoryHash: frozen.hash,
        rows: [0, 1, 2].map((ordinal) => ({ ordinal, requestedRole: "hero", componentType: "hero", compatibilityKind: "exact", compatibilityScore: 1, compatibilityRuleId: "section_component:exact:hero", required: true })),
      });
      expect(resolveSectionPlan(
        heroOnly,
        frozen,
        {
          intent: LEGACY_CONTEXT.intent,
          direction: CreativeDirectionSchema.parse(COLORING_DIRECTION),
        },
      )[0].sectionId).toBe("hero-best");
    }
  });

  it("does not select unpublished or JavaScript-dependent fragments", () => {
    const frozen = buildSectionCompositionInventory([
      record("hero-draft", "hero", HTML["hero-01"], { status: "draft" }),
      record("hero-js", "hero", HTML["hero-01"], { needsJs: true }),
    ]);
    expect(() => resolveSectionPlan(plan(frozen.hash), frozen, LEGACY_CONTEXT))
      .toThrow(SectionCompositionSelectionError);
  });

  it("rejects dashboard hero and feature variants for Mundo Pincel", () => {
    const frozen = buildSectionCompositionInventory([
      record("hero-01", "hero", "<section>dashboard</section>", { negativeSignals: ["dashboard", "analytics", "software_mockup"] }),
      record("hero-11", "hero", "<section>creator</section>", {
        name: "Illustrated Creator Playground",
        variantLabel: "Playful",
      }),
      record("features-01", "features", "<section>analytics</section>", { negativeSignals: ["dashboard", "analytics"] }),
      record("features-11", "features", "<section>activity</section>", {
        name: "Creative Activity Cards",
        variantLabel: "Playful",
      }),
      record("features-12", "features", "<section>stories</section>"),
      record("features-13", "features", "<section>games</section>"),
    ]);
    const selection = resolveSectionPlan(plan(frozen.hash), frozen, CONTEXT);
    const ids = selection.map((row) => row.sectionId);
    expect(ids).not.toContain("hero-01");
    expect(ids).not.toContain("features-01");
    expect(ids).toContain("hero-11");
    expect(ids).toContain("features-11");
  });

  it("fails closed when every candidate for a required role is forbidden", () => {
    const frozen = buildSectionCompositionInventory([
      record("hero-01", "hero", "<section>dashboard</section>", { negativeSignals: ["dashboard", "analytics", "software_mockup"] }),
    ]);
    const heroOnly = SectionPlanSchema.parse({
      schemaVersion: "section-plan/1.0",
      intentHash: `sha256:${"c".repeat(64)}`,
      inventoryHash: frozen.hash,
      rows: [{
        ordinal: 0,
        requestedRole: "hero",
        componentType: "hero",
        compatibilityKind: "exact",
        compatibilityScore: 1,
        compatibilityRuleId: "section_component:exact:hero",
        required: true,
      }],
    });
    expect(() => resolveSectionPlan(heroOnly, frozen, CONTEXT))
      .toThrow(expect.objectContaining({ code: "section_semantic_coverage_failed" }));
  });

  it("backtracks from one strong donor to three deterministic source templates", () => {
    const frozen = buildSectionCompositionInventory([
      record("hero-shared", "hero", "<section>hero shared</section>", { sourceTemplateId: "shared", sourceBandOrdinal: 0 }),
      record("features-shared-a", "features", "<section>shared a</section>", { sourceTemplateId: "shared", sourceBandOrdinal: 1 }),
      record("features-shared-b", "features", "<section>shared b</section>", { sourceTemplateId: "shared", sourceBandOrdinal: 2 }),
      record("features-donor-b", "features", "<section>donor b</section>", { sourceTemplateId: "donor-b", sourceBandOrdinal: 4 }),
      record("features-donor-c", "features", "<section>donor c</section>", { sourceTemplateId: "donor-c", sourceBandOrdinal: 7 }),
    ]);
    const selection = resolveSectionPlan(plan(frozen.hash), frozen, CONTEXT);
    expect(new Set(selection.map((row) => row.sourceTemplateId)).size).toBeGreaterThanOrEqual(3);
    expect(Math.max(...[...new Set(selection.map((row) => row.sourceTemplateId))].map((donor) => selection.filter((row) => row.sourceTemplateId === donor).length))).toBeLessThanOrEqual(2);
  });

  it("fails originality instead of reconstructing all bands from one template", () => {
    const frozen = buildSectionCompositionInventory([
      record("hero-one", "hero", "<section>hero</section>", { sourceTemplateId: "single", sourceBandOrdinal: 0 }),
      record("features-one", "features", "<section>one</section>", { sourceTemplateId: "single", sourceBandOrdinal: 1 }),
      record("features-two", "features", "<section>two</section>", { sourceTemplateId: "single", sourceBandOrdinal: 2 }),
      record("features-three", "features", "<section>three</section>", { sourceTemplateId: "single", sourceBandOrdinal: 3 }),
    ]);
    expect(() => resolveSectionPlan(plan(frozen.hash), frozen, CONTEXT))
      .toThrow(expect.objectContaining({ code: "section_originality_failed" }));
  });

  it("rejects fetched bytes whose content hash changed without selecting an alternate", async () => {
    const frozen = inventory();
    const selection = resolveSectionPlan(plan(frozen.hash), frozen, LEGACY_CONTEXT);
    const fetchText = vi.fn(async () => "changed bytes");
    await expect(fetchVerifiedSectionFragments(selection, frozen, { fetchText }))
      .resolves.toEqual({ ok: false, code: "section_fragment_stale" });
    expect(fetchText).toHaveBeenCalledTimes(1);
    expect(fetchText).toHaveBeenCalledWith("https://storage.invalid/hero-01.html");
  });

  it("returns unavailable for missing bytes and never falls through to another variant", async () => {
    const frozen = inventory();
    const selection = resolveSectionPlan(plan(frozen.hash), frozen, LEGACY_CONTEXT);
    const fetchText = vi.fn(async () => null);
    await expect(fetchVerifiedSectionFragments(selection, frozen, { fetchText }))
      .resolves.toEqual({ ok: false, code: "section_fragment_unavailable" });
    expect(fetchText).toHaveBeenCalledTimes(1);
  });

  it("returns the exact selected fragments after verifying every frozen hash", async () => {
    const frozen = inventory();
    const selection = resolveSectionPlan(plan(frozen.hash), frozen, LEGACY_CONTEXT);
    const fetchText = vi.fn(async (url: string) => HTML[url.split("/").pop()!.replace(".html", "")]);
    const result = await fetchVerifiedSectionFragments(selection, frozen, { fetchText });
    expect(result.ok && result.fragments.map((row) => row.slug)).toEqual(
      selection.map((row) => row.sectionId),
    );
    expect(fetchText).toHaveBeenCalledTimes(4);
  });

  it("rejects a full document with a valid hash and section marker", async () => {
    const html = "<!doctype html><html><head></head><body><section data-sec=\"hero-01\">Hero</section></body></html>";
    const frozen = buildSectionCompositionInventory([record("hero-01", "hero", html)]);
    const selection = [{ ...plan(frozen.hash).rows[0], inventoryHash: frozen.hash, sectionId: "hero-01", contentHash: sha12(html) }];
    await expect(fetchVerifiedSectionFragments(selection, frozen, { fetchText: async () => html }))
      .resolves.toEqual({ ok: false, code: "section_fragment_invalid" });
  });

  it("ignores document-shaped text in comments and raw-text elements", async () => {
    const html = "<!-- <html><body>ignored</body></html> --><style>.x::before{content:'<body>'}</style><section data-sec=\"hero-01\">Hero</section>";
    const frozen = buildSectionCompositionInventory([record("hero-01", "hero", html)]);
    const selection = [{ ...plan(frozen.hash).rows[0], inventoryHash: frozen.hash, sectionId: "hero-01", contentHash: sha12(html) }];
    await expect(fetchVerifiedSectionFragments(selection, frozen, { fetchText: async () => html }))
      .resolves.toMatchObject({ ok: true, fragments: [{ slug: "hero-01", html }] });
  });

  it("does not treat a self-closing non-void style tag as closed", async () => {
    const html = "<style/><section data-sec=\"hero-01\">swallowed</section>";
    const frozen = buildSectionCompositionInventory([record("hero-01", "hero", html)]);
    const selection = [{ ...plan(frozen.hash).rows[0], inventoryHash: frozen.hash, sectionId: "hero-01", contentHash: sha12(html) }];
    await expect(fetchVerifiedSectionFragments(selection, frozen, { fetchText: async () => html }))
      .resolves.toEqual({ ok: false, code: "section_fragment_invalid" });
  });

  it("does not treat a self-closing non-void HTML div as closed", async () => {
    const html = "<div/><section data-sec=\"hero-01\">swallowed</section>";
    const frozen = buildSectionCompositionInventory([record("hero-01", "hero", html)]);
    const selection = [{ ...plan(frozen.hash).rows[0], inventoryHash: frozen.hash, sectionId: "hero-01", contentHash: sha12(html) }];
    await expect(fetchVerifiedSectionFragments(selection, frozen, { fetchText: async () => html }))
      .resolves.toEqual({ ok: false, code: "section_fragment_invalid" });
  });

  it("accepts self-closing children in SVG and MathML foreign content", async () => {
    const fragments = [
      "<section data-sec=\"hero-01\"><svg viewBox=\"0 0 10 10\"><path d=\"M0 0\" /><use href=\"#dot\" /><circle cx=\"5\" cy=\"5\" r=\"2\" /></svg></section>",
      "<section data-sec=\"hero-01\"><math><mspace width=\"1em\"/><mi/></math></section>",
    ];
    for (const html of fragments) {
      const frozen = buildSectionCompositionInventory([record("hero-01", "hero", html)]);
      const selection = [{ ...plan(frozen.hash).rows[0], inventoryHash: frozen.hash, sectionId: "hero-01", contentHash: sha12(html) }];
      await expect(fetchVerifiedSectionFragments(selection, frozen, { fetchText: async () => html }))
        .resolves.toMatchObject({ ok: true, fragments: [{ slug: "hero-01", html }] });
    }
  });

  it("keeps HTML non-void rules inside foreign integration points", async () => {
    const html = "<section data-sec=\"hero-01\"><svg><foreignObject><div/></foreignObject></svg></section>";
    const frozen = buildSectionCompositionInventory([record("hero-01", "hero", html)]);
    const selection = [{ ...plan(frozen.hash).rows[0], inventoryHash: frozen.hash, sectionId: "hero-01", contentHash: sha12(html) }];
    await expect(fetchVerifiedSectionFragments(selection, frozen, { fetchText: async () => html }))
      .resolves.toEqual({ ok: false, code: "section_fragment_invalid" });
  });

  it("applies HTML integration-child rules beneath an SVG title", async () => {
    const invalidHtml = "<section data-sec=\"hero-01\"><svg><title><div/></title></svg></section>";
    const validHtml = "<section data-sec=\"hero-01\"><svg><title>Plain text</title></svg></section>";
    for (const [html, expected] of [
      [invalidHtml, { ok: false, code: "section_fragment_invalid" }],
      [validHtml, { ok: true }],
    ] as const) {
      const frozen = buildSectionCompositionInventory([record("hero-01", "hero", html)]);
      const selection = [{ ...plan(frozen.hash).rows[0], inventoryHash: frozen.hash, sectionId: "hero-01", contentHash: sha12(html) }];
      await expect(fetchVerifiedSectionFragments(selection, frozen, { fetchText: async () => html }))
        .resolves.toMatchObject(expected);
    }
  });

  it("ignores document-shaped literals in every raw-text and RCDATA element", async () => {
    for (const tag of ["script", "style", "textarea", "title", "iframe", "xmp", "noembed", "noframes"]) {
      const html = `<section data-sec=\"hero-01\"><${tag}><html><head></head><body>literal</body></html></${tag}><br/>Hero</section>`;
      const frozen = buildSectionCompositionInventory([record("hero-01", "hero", html)]);
      const selection = [{ ...plan(frozen.hash).rows[0], inventoryHash: frozen.hash, sectionId: "hero-01", contentHash: sha12(html) }];
      await expect(fetchVerifiedSectionFragments(selection, frozen, { fetchText: async () => html }))
        .resolves.toMatchObject({ ok: true, fragments: [{ slug: "hero-01", html }] });
    }
  });

  it("requires exactly one matching fragment root beyond style and link nodes", async () => {
    const invalidFragments = [
      "<section data-sec=\"hero-01\">one</section><section data-sec=\"hero-01\">two</section>",
      "<section><div data-sec=\"hero-01\">nested</div></section>",
      "<section data-sec=\"other\">wrong</section>",
    ];
    for (const html of invalidFragments) {
      const frozen = buildSectionCompositionInventory([record("hero-01", "hero", html)]);
      const selection = [{ ...plan(frozen.hash).rows[0], inventoryHash: frozen.hash, sectionId: "hero-01", contentHash: sha12(html) }];
      await expect(fetchVerifiedSectionFragments(selection, frozen, { fetchText: async () => html }))
        .resolves.toEqual({ ok: false, code: "section_fragment_invalid" });
    }
  });
});
