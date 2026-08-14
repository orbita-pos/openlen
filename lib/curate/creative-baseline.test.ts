import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { detectTemplateLeaks } from "@/lib/assemble/leaks";
import type { BusinessProfileData } from "@/lib/business-profiles/types";
import type { SectionRecord } from "@/lib/sections/store";
import type { SectionType } from "@/lib/sections/types";
import { buildCreativeBaseline, type CreativeBaselineDeps } from "./creative-baseline";

const sha12 = (html: string) => createHash("sha256").update(html).digest("hex").slice(0, 12);

function section(id: string, type: SectionType): SectionRecord {
  const html = `<section data-sec="${id}"><h2>MORADA ${type}</h2><p>Donor copy for ${type}</p><a href="#">Read donor details</a></section>`;
  return {
    id, type, name: id, variantLabel: id, rootTag: "section", mode: "cream",
    storageKey: `sections/${id}-${sha12(html)}.html`, storageUrl: `https://storage.invalid/${id}.html`,
    contentHash: sha12(html), size: html.length, designTokens: {}, fonts: null,
    needsJs: false, hasPlaceholders: false, thumbnailUrl: null,
    provenance: {
      schemaVersion: "derived-section-provenance/1.0", sourceTemplateId: `donor-${id}`,
      sourceTemplateHash: "a".repeat(12), sourceBandOrdinal: 0,
      extractionVersion: "template-band-extractor/1.0", sourceHash: `sha256:${"a".repeat(64)}`,
      structuralFingerprint: `sha256:${createHash("sha256").update(id).digest("hex")}`,
    },
    derivedSemantics: {
      schemaVersion: "derived-section-semantics/1.0", role: type,
      layoutArchetypes: ["centered"], domains: ["children_creativity"], audiences: ["children"], moods: ["playful"], negativeSignals: [],
    },
    status: "published", createdAt: new Date(0), updatedAt: new Date(0), publishedAt: new Date(0),
  };
}

const RECORDS = [
  section("navbar-11", "navbar"), section("hero-11", "hero"), section("gallery-11", "gallery"),
  section("features-11", "features"), section("features-12", "features"), section("features-13", "features"),
  section("footer-11", "footer"),
];
const LEAKY_SOURCE = RECORDS.map((record) => `<section><h2>MORADA ${record.type}</h2><p>Donor copy for ${record.type}</p><a>Read donor details</a></section>`).join("");
const LEAKY_FRAGMENTS = new Map(RECORDS.map((record) => [
  record.storageUrl,
  `<section data-sec="${record.id}"><h2>MORADA ${record.type}</h2><p>Donor copy for ${record.type}</p><a href="#">Read donor details</a></section>`,
]));

const INPUT = {
  projectId: "project-1",
  brief: 'Crea una plataforma infantil llamada "Mundo Pincel" para colorear, jugar minijuegos y leer cuentos.',
  profileData: { brand: { accent: "#F06AA6", logoUrl: null } } as BusinessProfileData,
  records: RECORDS,
};

function makeDeps(overrides: Partial<CreativeBaselineDeps> = {}): CreativeBaselineDeps {
  return {
    fragments: LEAKY_FRAGMENTS,
    render: async () => ({
      desktop: { mimeType: "image/jpeg", dataBase64: "aGVsbG8=" },
      mobile: { mimeType: "image/jpeg", dataBase64: "aGVsbG8=" },
      mobileOverflow: false,
      weakTypographyHierarchy: false,
      invalidGeometry: false,
    }),
    ...overrides,
  };
}

describe("buildCreativeBaseline", () => {
  it("builds and renders a safe Mundo Pincel baseline without any provider", async () => {
    const provider = vi.fn(() => { throw new Error("provider must not run"); });
    const result = await buildCreativeBaseline(INPUT, makeDeps({ provider }));

    expect(result).toMatchObject({ ok: true, candidate: { title: "Mundo Pincel", source: "baseline" } });
    if (!result.ok) return;
    expect(result.candidate.html).toContain('data-openlen-role="hero"');
    expect(result.candidate.html).not.toContain("MORADA");
    expect(result.candidate.visualEngine.templateId).toBeNull();
    expect(provider).not.toHaveBeenCalled();
  });

  it("fails before paid work when no catalog fragment can form a safe baseline", async () => {
    await expect(buildCreativeBaseline({ ...INPUT, records: [] }, makeDeps()))
      .resolves.toEqual({ ok: false, code: "section_inventory_unavailable" });
  });

  it("replaces every substantive donor text block locally", async () => {
    const result = await buildCreativeBaseline(INPUT, makeDeps({ fragments: LEAKY_FRAGMENTS }));

    expect(result.ok && detectTemplateLeaks(LEAKY_SOURCE, result.candidate.html).damaging).toEqual([]);
  });
});
