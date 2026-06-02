import { describe, it, expect } from "vitest";
import { RecipeSchema, recipeToTheme, type Recipe } from "./recipe";

const COPY = {
  business_name: "Helm",
  industry: "devtools",
  tagline_es: null,
  tagline_en: "Ship analytics your team trusts",
  pitch: "Governed product metrics in under a second.",
  hero_keyword: "analytics",
  features: [{ title: "Realtime", desc: "Spans in under a second." }],
  pricing: [],
  testimonials: [],
  cta_primary: "Start free",
  cta_secondary: null,
  faq_questions: [],
  language_detected: "en",
};

const VALID: Recipe = {
  theme: {
    mode: "dark",
    bg: "#0f0f0f",
    surface: "#161616",
    fg: "#ededed",
    border: "#2a2a2a",
    accent: "#3ecf8e",
    fontDisplay: "Space Grotesk",
    fontBody: "Inter",
    radius: "8px",
    rScale: 1,
  },
  sections: [
    { type: "navbar", variant: null },
    { type: "hero", variant: null },
    { type: "features", variant: null },
    { type: "footer", variant: null },
  ],
  copy: COPY,
};

describe("RecipeSchema — validate the model's JSON", () => {
  it("accepts a well-formed recipe", () => {
    expect(RecipeSchema.safeParse(VALID).success).toBe(true);
  });

  it("rejects a non-hex theme colour", () => {
    const bad = { ...VALID, theme: { ...VALID.theme, accent: "blue" } };
    expect(RecipeSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an unknown section type", () => {
    const bad = { ...VALID, sections: [{ type: "heroic", variant: null }, ...VALID.sections] };
    expect(RecipeSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects fewer than 3 sections", () => {
    const bad = { ...VALID, sections: VALID.sections.slice(0, 2) };
    expect(RecipeSchema.safeParse(bad).success).toBe(false);
  });
});

describe("recipeToTheme — resolve fonts to stacks + links", () => {
  it("maps font names to CSS stacks and collects Google-Fonts links", () => {
    const theme = recipeToTheme(VALID.theme);
    expect(theme.base).toEqual({ bg: "#0f0f0f", surface: "#161616", fg: "#ededed", border: "#2a2a2a", accent: "#3ecf8e" });
    expect(theme.mode).toBe("dark");
    expect(theme.fontDisplay).toBe("'Space Grotesk', sans-serif");
    expect(theme.fontBody).toBe("'Inter', sans-serif");
    expect(theme.radius).toBe("8px");
    expect(theme.fontLinks).toHaveLength(2);
    expect(theme.fontLinks?.some((l) => l.includes("Space+Grotesk"))).toBe(true);
    expect(theme.fontLinks?.some((l) => l.includes("family=Inter"))).toBe(true);
  });

  it("falls back to Inter for an unknown font name", () => {
    const theme = recipeToTheme({ ...VALID.theme, fontDisplay: "Comic Sans" });
    expect(theme.fontDisplay).toBe("'Inter', sans-serif");
  });

  it("dedupes the font link when display and body are the same font", () => {
    const theme = recipeToTheme({ ...VALID.theme, fontDisplay: "Inter", fontBody: "Inter" });
    expect(theme.fontLinks).toHaveLength(1);
  });

  it("serif display resolves to a serif stack", () => {
    const theme = recipeToTheme({ ...VALID.theme, fontDisplay: "Fraunces" });
    expect(theme.fontDisplay).toBe("'Fraunces', serif");
  });
});
