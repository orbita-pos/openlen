import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseCuratedImageManifest } from "@/lib/imagery/manifest";

const LEGACY_IMAGE = {
  id: "coloring-crayons",
  promptNum: 3,
  style: "hand-drawn-illustration",
  family: ["children-entertainment", "printable-activities"],
  alt: "Pastel crayons beside animal coloring pages",
  src: {
    hero: "https://images.openlen.com/coloring-crayons-1920.webp",
    tablet: "https://images.openlen.com/coloring-crayons-800.webp",
    thumb: "https://images.openlen.com/coloring-crayons-400.webp",
  },
};

describe("parseCuratedImageManifest", () => {
  it("keeps the complete required shape of a legacy row", () => {
    expect(parseCuratedImageManifest([LEGACY_IMAGE])).toEqual([LEGACY_IMAGE]);
  });

  it("preserves valid reviewed catalog metadata", () => {
    const reviewed = {
      ...LEGACY_IMAGE,
      domains: ["children_entertainment"],
      audiences: ["children"],
      visualSignals: ["friendly_animals", "coloring_pages"],
      negativeTags: ["corporate_dashboard"],
      mediaType: "illustration",
      license: "openlen_catalog",
      checksum: `sha256:${"a".repeat(64)}`,
    };

    expect(parseCuratedImageManifest({ images: [reviewed] })).toEqual([reviewed]);
  });

  it.each([
    ["domains", ["children-entertainment"]],
    ["audiences", ["children", "children"]],
    ["visualSignals", ["friendly_animals", 7]],
    ["negativeTags", "corporate_dashboard"],
    ["mediaType", "video"],
    ["license", "unknown_vendor"],
    ["checksum", "sha256:not-a-digest"],
  ])("rejects a row with malformed optional %s metadata", (field, value) => {
    expect(parseCuratedImageManifest([{ ...LEGACY_IMAGE, [field]: value }])).toEqual([]);
  });

  it("preserves the existing catalog exclusions", () => {
    expect(parseCuratedImageManifest([
      LEGACY_IMAGE,
      { ...LEGACY_IMAGE, id: "aetherborn-lyra-nobg" },
      { ...LEGACY_IMAGE, id: "376-lume-lemon-lime" },
      { ...LEGACY_IMAGE, id: "392-japan-sakura-tree" },
      { ...LEGACY_IMAGE, id: "400-worldcup-striker" },
      { ...LEGACY_IMAGE, id: "sleeping-kitten", style: "pet-editorial" },
    ])).toEqual([LEGACY_IMAGE]);
  });

  it("loads every currently eligible legacy catalog row", async () => {
    const document = JSON.parse(await readFile(path.join(process.cwd(), "public", "openlen-images", "manifest.json"), "utf8")) as { images: unknown[] };
    const raw = document.images;
    const expectedIds = raw
      .filter((row): row is { id: string; style: string } => {
        if (!row || typeof row !== "object") return false;
        const candidate = row as { id?: unknown; style?: unknown };
        return typeof candidate.id === "string"
          && typeof candidate.style === "string"
          && !/nobg|lume|japan|worldcup/i.test(candidate.id)
          && candidate.style !== "pet-editorial";
      })
      .map((row) => row.id);
    const parsedIds = parseCuratedImageManifest(raw).map((row) => row.id);

    expect(expectedIds).toHaveLength(501);
    expect(parsedIds).toEqual(expectedIds);
  });
});
