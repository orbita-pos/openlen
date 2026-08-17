// La dirección creativa decide la paleta, la tipografía y la geometría de la
// página — y hasta 2026-08-16 no llegaba al documento: `composeSectionCandidate`
// le pasaba a `assembleDocument` el `COMPOSITION_BASE_THEME` congelado, blanco y
// con acento gris, SIEMPRE. Una página de terror nacía en modo claro con fuente
// de sistema, y la corrida `horror-experience` del canario salió `delivered`
// renderizando crema sobre blanco.
import { describe, expect, it } from "vitest";
import { assembleThemeFor } from "./direction-theme";
import { assembleDocument, type SectionFragment } from "@/lib/sections/assemble";
import type { CreativeDirection } from "./creative-contracts";

const HORROR = {
  mode: "dark",
  archetype: "cinematic_horror_experience",
  tone: ["uneasy", "cinematic", "mysterious"],
  palette: {
    background: "#09090B",
    surface: "#151318",
    surfaceAlt: "#241A21",
    foreground: "#F7F1ED",
    foregroundMuted: "#B8A9AC",
    accent: "#B91C35",
    accentInk: "#FFFFFF",
    border: "#443038",
  },
  typography: { display: "elegant_editorial", body: "literary", mono: null, scale: "expressive" },
  geometry: { radius: "square", radiusScale: 0, spacingScale: 1.15, density: "low" },
} as unknown as CreativeDirection;

describe("assembleThemeFor", () => {
  it("carries the direction's palette instead of the light default", () => {
    const theme = assembleThemeFor(HORROR);

    expect(theme.mode).toBe("dark");
    expect(theme.base).toMatchObject({
      bg: "#09090B",
      fg: "#F7F1ED",
      accent: "#B91C35",
      border: "#443038",
    });
  });

  it("carries the direction's fonts instead of the system stack", () => {
    const theme = assembleThemeFor(HORROR);

    // elegant_editorial / literary — from CREATIVE_FONT_MOODS, the same table
    // the creative compiler reads. A horror page asking for dramatic type got
    // `ui-sans-serif, system-ui` and tripped weakTypographyHierarchy.
    expect(theme.fontDisplay).toContain("Playfair Display");
    expect(theme.fontBody).toContain("Crimson Pro");
    expect(theme.fontDisplay).not.toContain("system-ui");
  });

  it("carries the direction's geometry", () => {
    const theme = assembleThemeFor(HORROR);

    expect(theme.radius).toBe("0px");     // square
    expect(theme.rScale).toBe("0");
    expect(theme.spaceScale).toBe("1.15");
    expect(theme.textScale).toBe("1.08"); // expressive
  });

  it("stamps the dark theme onto <html>, which is what every section reads", () => {
    // The end-to-end symptom: `<html class="light" style="--ol-bg:#ffffff">`
    // beat the model's own dark CSS, because an inline custom property on the
    // root is the most specific place a var() can resolve from.
    const fragment: SectionFragment = {
      slug: "hero-1",
      type: "hero",
      html: '<section data-openlen-role="hero"><h1>EL UMBRAL</h1></section>',
    } as SectionFragment;

    const doc = assembleDocument([fragment], assembleThemeFor(HORROR));
    const openTag = doc.match(/<html[^>]*>/i)?.[0] ?? "";

    expect(openTag).toContain('class="dark"');
    expect(openTag).toContain("--ol-bg:#09090B");
    expect(openTag).toContain("--ol-accent:#B91C35");
    // Not "no #ffffff anywhere" — `--ol-accent-ink` is legitimately white here
    // (it is the ink ON the blood-red accent). The thing that must never be
    // white is the surface the page is painted on.
    expect(openTag).not.toMatch(/--ol-bg:\s*#(fff|ffffff)\b/i);
    expect(openTag).not.toContain("system-ui");
  });
});

describe("assembleThemeFor — language", () => {
  it("carries the analysed language into <html lang>, which was hardcoded en", async () => {
    const { assembleDocument } = await import("@/lib/sections/assemble");
    const fragment = { slug: "hero-1", type: "hero", html: '<section data-openlen-role="hero"><h1>x</h1></section>' } as never;

    const doc = assembleDocument([fragment], assembleThemeFor(HORROR, "es"));

    expect(doc.match(/<html[^>]*>/i)?.[0]).toContain('lang="es"');
  });

  it("keeps a language that is not shaped like a language tag out of the document", async () => {
    // `intent.language` is model output landing directly in an attribute.
    // Validated by SHAPE rather than escaped: a value that is not a language
    // tag has no business in `lang` at all, escaped or not.
    const { assembleDocument } = await import("@/lib/sections/assemble");
    const fragment = { slug: "hero-1", type: "hero", html: '<section data-openlen-role="hero"><h1>x</h1></section>' } as never;

    const doc = assembleDocument([fragment], assembleThemeFor(HORROR, '"><script>alert(1)</script>'));
    const openTag = doc.match(/<html[^>]*>/i)?.[0] ?? "";

    expect(openTag).toContain('lang="en"');
    expect(doc).not.toContain("alert(1)");
  });
});
