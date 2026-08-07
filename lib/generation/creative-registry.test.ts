import { describe, expect, it } from "vitest";
import { CREATIVE_FONT_MOODS, CREATIVE_TOKEN_ALLOWLIST, HOOK_PROPERTY_POLICY } from "@/lib/generation/creative-registry";

describe("creative registry", () => {
  it("exposes the exact approved creative tokens", () => {
    expect([...CREATIVE_TOKEN_ALLOWLIST]).toEqual([
      "--ol-bg", "--ol-surface", "--ol-surface-2", "--ol-fg",
      "--ol-fg-muted", "--ol-fg-faint", "--ol-border",
      "--ol-border-strong", "--ol-accent", "--ol-accent-ink",
      "--ol-radius", "--ol-r-scale", "--ol-space-scale",
      "--ol-text-scale", "--ol-font-display", "--ol-font-body",
      "--ol-font-mono",
    ]);
  });

  it("exposes the exact approved font moods", () => {
    expect(CREATIVE_FONT_MOODS).toEqual({
      rounded_playful: { display: "'Plus Jakarta Sans', sans-serif", body: "'Plus Jakarta Sans', sans-serif" },
      friendly_high_legibility: { display: "'Manrope', sans-serif", body: "'Inter', sans-serif" },
      modern_geometric: { display: "'Space Grotesk', sans-serif", body: "'Inter', sans-serif" },
      editorial_warm: { display: "'Fraunces', serif", body: "'Inter', sans-serif" },
      literary: { display: "'Crimson Pro', serif", body: "'Crimson Pro', serif" },
      elegant_editorial: { display: "'Playfair Display', serif", body: "'Inter', sans-serif" },
      technical: { display: "'Geist', sans-serif", body: "'Inter', sans-serif" },
    });
  });

  it("exposes the exact approved hook policies", () => {
    expect(HOOK_PROPERTY_POLICY).toEqual({
      page: ["background-color", "color", "font-family"],
      navigation: ["background-color", "color", "border-color", "border-radius", "padding", "gap", "box-shadow"],
      hero: ["background-color", "color", "border-color", "border-radius", "padding", "gap", "box-shadow", "text-align"],
      section: ["background-color", "color", "border-color", "border-radius", "padding", "gap"],
      cards: ["background-color", "color", "border-color", "border-radius", "padding", "gap", "box-shadow"],
      buttons: ["background-color", "color", "border-color", "border-radius", "padding", "box-shadow"],
      icons: ["color", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "border-radius"],
    });
  });
});
