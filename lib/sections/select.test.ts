import { describe, it, expect } from "vitest";
import { scoreVariant, rankVariants, rankCompositionVariants } from "./select";
import { CreativeDirectionSchema } from "@/lib/generation/creative-contracts";
import type { SectionRecord } from "./store";
import type { SectionMode, SectionType } from "./types";
import type { AssembleTheme } from "./assemble";

const DARK: AssembleTheme = {
  base: { bg: "#0f0f0f", surface: "#131313", fg: "#ededed", border: "#2a2a2a", accent: "#3ecf8e" },
  mode: "dark",
  fontDisplay: "'Inter', sans-serif",
  fontBody: "'Inter', sans-serif",
  radius: "10px",
};
const LIGHT: AssembleTheme = { ...DARK, mode: "light", base: { ...DARK.base, bg: "#ffffff", fg: "#0b0d12" } };

function mk(
  id: string,
  mode: SectionMode,
  opts?: { radius?: string; needsJs?: boolean; type?: SectionType },
): SectionRecord {
  return {
    id,
    type: opts?.type ?? "hero",
    name: id,
    variantLabel: id,
    rootTag: "section",
    mode,
    storageKey: `sections/${id}.html`,
    storageUrl: `https://x/${id}.html`,
    contentHash: "abc",
    size: 1,
    designTokens: opts?.radius ? { "--radius": opts.radius } : null,
    fonts: null,
    needsJs: opts?.needsJs ?? false,
    hasPlaceholders: false,
    thumbnailUrl: null,
    status: "published",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    publishedAt: new Date(0),
  };
}

describe("scoreVariant / rankVariants — deterministic mode+radius selection", () => {
  it("mode match dominates everything", () => {
    const ranked = rankVariants([mk("light-1", "light"), mk("dark-1", "dark")], DARK);
    expect(ranked[0].id).toBe("dark-1");
  });

  it("treats light and cream as compatible, dark as incompatible on a light page", () => {
    expect(scoreVariant(mk("c", "cream"), LIGHT)).toBeGreaterThan(scoreVariant(mk("d", "dark"), LIGHT));
  });

  it("prefers the closer radius bucket when mode is equal", () => {
    const sharp = mk("sharp", "dark", { radius: "2px" });
    const soft = mk("soft", "dark", { radius: "24px" });
    const themeSharp: AssembleTheme = { ...DARK, radius: "3px" };
    const ranked = rankVariants([soft, sharp], themeSharp);
    expect(ranked[0].id).toBe("sharp");
  });

  it("penalizes needsJs as a tiebreaker", () => {
    const plain = mk("plain", "dark", { radius: "10px", needsJs: false });
    const js = mk("js", "dark", { radius: "10px", needsJs: true });
    const ranked = rankVariants([js, plain], DARK);
    expect(ranked[0].id).toBe("plain");
  });

  it("breaks exact ties by slug for reproducibility", () => {
    const ranked = rankVariants([mk("z-1", "dark", { radius: "10px" }), mk("a-1", "dark", { radius: "10px" })], DARK);
    expect(ranked.map((r) => r.id)).toEqual(["a-1", "z-1"]);
  });

  it("a mode-matched JS variant still beats a mode-mismatched plain one", () => {
    const matchedJs = mk("m", "dark", { radius: "10px", needsJs: true });
    const mismatched = mk("x", "light", { radius: "10px" });
    expect(scoreVariant(matchedJs, DARK)).toBeGreaterThan(scoreVariant(mismatched, DARK));
  });
});

describe("rankCompositionVariants", () => {
  const direction = CreativeDirectionSchema.parse({
    schemaVersion: "creative-direction/1.0",
    mode: "light",
    visualArchetype: "playful_editorial",
    emotionalTone: ["playful"],
    palette: { background: "#FFF8FC", surface: "#FFFFFF", surfaceAlt: "#FFF0F7", foreground: "#382A35", foregroundMuted: "#756672", accent: "#F06AA6", accentInk: "#FFFFFF", border: "#F3C9DD" },
    typography: { display: "rounded_playful", body: "friendly_high_legibility", mono: null, scale: "expressive" },
    geometry: { radius: "extra_round", radiusScale: 1.75, spacingScale: 1.15, density: "low_medium" },
    imagery: { strategy: "illustration_first", artDirection: "childrens_coloring", subjects: ["coloring_pages"], avoid: ["corporate_dashboard"] },
    iconography: { style: "rounded_outline", strokeWeight: "medium", cornerStyle: "round" },
    componentTreatment: { cards: "playful", buttons: "pill", navigation: "friendly", sections: "airy" },
    requiredVisualSignals: ["coloring_art"],
    forbiddenVisualSignals: ["corporate_dashboard"],
  });

  it("uses composition signals but keeps exact ties ordered by id", () => {
    const ranked = rankCompositionVariants([
      { id: "z", mode: "light", radiusBucket: "soft", density: "unknown", needsJs: false },
      { id: "a", mode: "light", radiusBucket: "soft", density: "unknown", needsJs: false },
      { id: "sharp", mode: "light", radiusBucket: "sharp", density: "unknown", needsJs: false },
    ], direction);
    expect(ranked.map((row) => row.id)).toEqual(["a", "z", "sharp"]);
  });
});
