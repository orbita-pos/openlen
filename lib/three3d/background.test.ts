import { describe, it, expect } from "vitest";
import { backgroundCss } from "./background";
import { SAMPLE_SPEC } from "./scene-spec";

describe("backgroundCss", () => {
  it("returns null for transparent background", () => {
    expect(backgroundCss({ ...SAMPLE_SPEC, background: "transparent" })).toBeNull();
  });
  it("returns a gradient incorporating the accent for a gradient background", () => {
    const css = backgroundCss({ ...SAMPLE_SPEC, background: "gradient", material: { ...SAMPLE_SPEC.material, colors: ["#7C5CFF"] } });
    expect(css).toContain("linear-gradient");
    expect(css!.toLowerCase()).toContain("7c5cff");
  });
  it("dramatic look yields a dark base", () => {
    const css = backgroundCss({ ...SAMPLE_SPEC, background: "gradient", look: "dramatic" });
    expect(css).toMatch(/#12|#1b/);
  });
});
