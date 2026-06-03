import { describe, it, expect } from "vitest";
import { PickSchema, pickWeighted, buildCatalog, pickSystemPrompt, type TemplateCatalogItem } from "./pick-template";

const CATALOG: TemplateCatalogItem[] = [
  { id: "mirror", name: "Mirror", family: "saas", mode: "dark", pitch: "Sharp dark SaaS landing" },
  { id: "manuscript", name: "Manuscript", family: "editorial", mode: "cream", pitch: "Warm editorial studio" },
];

const COPY = {
  business_name: "Helm",
  industry: "devtools",
  tagline_es: null,
  tagline_en: "Ship analytics your team trusts",
  pitch: "Governed metrics in under a second.",
  hero_keyword: "analytics",
  features: [],
  pricing: [],
  testimonials: [],
  cta_primary: "Start free",
  cta_secondary: null,
  faq_questions: [],
  language_detected: "en",
};

describe("PickSchema", () => {
  it("accepts a valid ranked pick", () => {
    expect(PickSchema.safeParse({ templateIds: ["mirror", "manuscript"], copy: COPY }).success).toBe(true);
  });
  it("rejects missing/empty templateIds", () => {
    expect(PickSchema.safeParse({ copy: COPY }).success).toBe(false);
    expect(PickSchema.safeParse({ templateIds: [], copy: COPY }).success).toBe(false);
  });
  it("accepts partial copy (lenient — fills omitted fields with null/[])", () => {
    const r = PickSchema.safeParse({ templateIds: ["mirror"], copy: { business_name: "x", tagline_en: "t" } });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.copy.tagline_es).toBeNull(); // omitted → null
      expect(r.data.copy.features).toEqual([]); // omitted → []
    }
  });
});

describe("pickWeighted", () => {
  it("returns the only id when the list has one", () => {
    expect(pickWeighted(["solo"])).toBe("solo");
  });
  it("favors #1 but can return later ranks (harmonic weights)", () => {
    const ids = ["a", "b", "c"];
    // rnd→0 lands in #1's weight band; rnd→~just-under-1 lands in the last.
    expect(pickWeighted(ids, () => 0)).toBe("a");
    expect(pickWeighted(ids, () => 0.999)).toBe("c");
    // #1's band is the largest (≈0.55 of total): mid-low value still #1.
    expect(pickWeighted(ids, () => 0.4)).toBe("a");
  });
  it("always returns a member of the list", () => {
    const ids = ["x", "y", "z"];
    for (let i = 0; i < 50; i++) {
      expect(ids).toContain(pickWeighted(ids, () => i / 50));
    }
  });
});

describe("buildCatalog / pickSystemPrompt", () => {
  it("formats catalog rows with id · name · family · mode · pitch", () => {
    const out = buildCatalog(CATALOG);
    expect(out).toContain("mirror · Mirror · family=saas · mode=dark · Sharp dark SaaS landing");
    expect(out.split("\n")).toHaveLength(2);
  });
  it("embeds the catalog + the exact-id constraint in the prompt", () => {
    const prompt = pickSystemPrompt(buildCatalog(CATALOG));
    expect(prompt).toContain("mirror · Mirror");
    expect(prompt).toContain("manuscript · Manuscript");
    expect(prompt).toMatch(/MUST be 3 ids/);
  });
});
