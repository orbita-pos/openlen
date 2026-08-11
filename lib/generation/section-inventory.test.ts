import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { SectionPlanSchema } from "./section-composition-contracts";
import { CreativeDirectionSchema } from "./creative-contracts";
import { COLORING_DIRECTION } from "./creative-fixtures.test-support";
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
  } = {},
): SectionRecord {
  return {
    id,
    type,
    name: `<html hidden name ${id}>`,
    variantLabel: `variant ${id}`,
    rootTag: "section",
    mode: opts.mode ?? "light",
    storageKey: opts.storageKey ?? `sections/${id}-${sha12(html)}.html`,
    storageUrl: `https://storage.invalid/${id}.html`,
    contentHash: opts.contentHash ?? sha12(html),
    size: html.length,
    designTokens: opts.radius ? { "--radius": opts.radius } : null,
    fonts: null,
    needsJs: opts.needsJs ?? false,
    hasPlaceholders: opts.hasPlaceholders ?? false,
    thumbnailUrl: null,
    status: opts.status ?? "published",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    publishedAt: opts.status === "draft" ? null : new Date(0),
  };
}

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
    const draft = record("gallery-draft", "gallery", "<section>draft</section>", { status: "draft" });
    const publishedA = record("hero-01", "hero", HTML["hero-01"], { radius: "24px", hasPlaceholders: true });
    const publishedB = record("features-01", "features", HTML["features-01"]);
    const first = buildSectionCompositionInventory([draft, publishedB, publishedA]);
    const second = buildSectionCompositionInventory([publishedA, draft, publishedB]);

    expect(first).toEqual(second);
    expect(first.entries.map((row) => row.id)).toEqual(["features-01", "hero-01"]);
    expect(first.entries[1]).toMatchObject({ radiusBucket: "soft", density: "unknown", assetCapability: "replaceable" });
    expect(Object.keys(first.entries[0]).sort()).toEqual([
      "assetCapability", "contentHash", "density", "id", "mode", "needsJs", "radiusBucket", "type",
    ]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.entries)).toBe(true);
    expect(first.entries.every(Object.isFrozen)).toBe(true);
    expect(JSON.stringify(first)).not.toContain("storageUrl");
    expect(JSON.stringify(first)).not.toContain("<html");
  });

  it("selects repeatable distinct variants for repeated semantic roles", () => {
    const frozen = inventory();
    const first = resolveSectionPlan(plan(frozen.hash), frozen, null);
    const second = resolveSectionPlan(plan(frozen.hash), frozen, null);
    expect(first).toEqual(second);
    expect(first.map((row) => row.requestedRole)).toEqual(["hero", "minigames", "stories", "activities"]);
    expect(first.filter((row) => row.componentType === "features").map((row) => row.sectionId)).toEqual([
      "features-01", "features-02", "features-03",
    ]);
  });

  it("rejects a plan created against another frozen inventory", () => {
    const frozen = inventory();
    expect(() => resolveSectionPlan(plan(`sha256:${"b".repeat(64)}`), frozen, null))
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
        rows: [{ ordinal: 0, requestedRole: "hero", componentType: "hero", compatibilityKind: "exact", compatibilityScore: 1, compatibilityRuleId: "section_component:exact:hero", required: true }],
      });
      expect(resolveSectionPlan(
        heroOnly,
        frozen,
        CreativeDirectionSchema.parse(COLORING_DIRECTION),
      )[0].sectionId).toBe("hero-best");
    }
  });

  it("does not select unpublished or JavaScript-dependent fragments", () => {
    const frozen = buildSectionCompositionInventory([
      record("hero-draft", "hero", HTML["hero-01"], { status: "draft" }),
      record("hero-js", "hero", HTML["hero-01"], { needsJs: true }),
    ]);
    expect(() => resolveSectionPlan(plan(frozen.hash), frozen, null))
      .toThrow(SectionCompositionSelectionError);
  });

  it("rejects fetched bytes whose content hash changed without selecting an alternate", async () => {
    const frozen = inventory();
    const selection = resolveSectionPlan(plan(frozen.hash), frozen, null);
    const fetchText = vi.fn(async () => "changed bytes");
    await expect(fetchVerifiedSectionFragments(selection, frozen, { fetchText }))
      .resolves.toEqual({ ok: false, code: "section_fragment_stale" });
    expect(fetchText).toHaveBeenCalledTimes(1);
    expect(fetchText).toHaveBeenCalledWith("https://storage.invalid/hero-01.html");
  });

  it("returns unavailable for missing bytes and never falls through to another variant", async () => {
    const frozen = inventory();
    const selection = resolveSectionPlan(plan(frozen.hash), frozen, null);
    const fetchText = vi.fn(async () => null);
    await expect(fetchVerifiedSectionFragments(selection, frozen, { fetchText }))
      .resolves.toEqual({ ok: false, code: "section_fragment_unavailable" });
    expect(fetchText).toHaveBeenCalledTimes(1);
  });

  it("returns the exact selected fragments after verifying every frozen hash", async () => {
    const frozen = inventory();
    const selection = resolveSectionPlan(plan(frozen.hash), frozen, null);
    const fetchText = vi.fn(async (url: string) => HTML[url.split("/").pop()!.replace(".html", "")]);
    const result = await fetchVerifiedSectionFragments(selection, frozen, { fetchText });
    expect(result.ok && result.fragments.map((row) => row.slug)).toEqual([
      "hero-01", "features-01", "features-02", "features-03",
    ]);
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
