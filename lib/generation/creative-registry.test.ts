import { describe, expect, it } from "vitest";
import { CREATIVE_FONT_MOODS, CREATIVE_TOKEN_ALLOWLIST, HOOK_PROPERTY_POLICY } from "@/lib/generation/creative-registry";

describe("creative registry", () => {
  it("exposes only approved creative tokens", () => {
    expect(CREATIVE_TOKEN_ALLOWLIST.has("--ol-accent")).toBe(true);
    expect(CREATIVE_TOKEN_ALLOWLIST.has("--evil")).toBe(false);
  });

  it("maps supported font moods and hook properties", () => {
    expect(CREATIVE_FONT_MOODS.rounded_playful.display).toBe("'Plus Jakarta Sans', sans-serif");
    expect(HOOK_PROPERTY_POLICY.hero).toContain("text-align");
    expect(HOOK_PROPERTY_POLICY.page).not.toContain("box-shadow");
  });
});
