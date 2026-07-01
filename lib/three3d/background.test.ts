import { describe, it, expect } from "vitest";
import { backgroundCss } from "./background";
import { SAMPLE_SPEC } from "./scene-spec";

describe("backgroundCss", () => {
  it("returns null for transparent background", () => {
    expect(backgroundCss({ ...SAMPLE_SPEC, background: "transparent" })).toBeNull();
  });
  it("returns a gradient incorporating the accent for a gradient background", () => {
    const css = backgroundCss({ ...SAMPLE_SPEC, background: "gradient", material: { ...SAMPLE_SPEC.material, kind: "glass", colors: ["#7C5CFF"] } });
    expect(css).toContain("linear-gradient");
    expect(css!.toLowerCase()).toContain("7c5cff");
  });
  it("dramatic look yields a dark base for non-glass materials", () => {
    const css = backgroundCss({
      ...SAMPLE_SPEC,
      background: "gradient",
      look: "dramatic",
      material: { ...SAMPLE_SPEC.material, kind: "matte" },
    });
    expect(css).toMatch(/#12|#1b/);
  });
  it("glassy material with dramatic look yields a light base (not dark)", () => {
    const css = backgroundCss({
      ...SAMPLE_SPEC,
      background: "gradient",
      look: "dramatic",
      material: { ...SAMPLE_SPEC.material, kind: "glass", colors: ["#7C5CFF"] },
    });
    expect(css).toContain("linear-gradient");
    expect(css).not.toMatch(/#12|#1b/);
  });
  it("emissive material yields a dark aurora gradient regardless of look", () => {
    const css = backgroundCss({ ...SAMPLE_SPEC, material: { ...SAMPLE_SPEC.material, kind: "emissive" }, look: "soft", background: "gradient" });
    expect(css).toContain("linear-gradient");
    expect(css).toMatch(/#0a0a1f|#1a0a2e/); // dark aurora base
  });
  it("iridescent material yields a deep-navy gradient (not the glass light backdrop)", () => {
    const css = backgroundCss({ ...SAMPLE_SPEC, material: { ...SAMPLE_SPEC.material, kind: "iridescent" }, look: "soft", background: "gradient" });
    expect(css).toContain("linear-gradient");
    expect(css).toMatch(/#0a0e2a|#1a0e3a/); // deep navy
    expect(css).not.toMatch(/#f7|#ef/); // NOT a light glass base
  });
  it("shader spec returns the dark base gradient (contains #0a0a16)", () => {
    const css = backgroundCss({ ...SAMPLE_SPEC, shader: "fluid", background: "gradient" });
    expect(css).toContain("#0a0a16");
    expect(css).not.toMatch(/#0a0e2a|#1a0e3a/); // not iridescent navy
    expect(css).not.toMatch(/#f7|#ef/); // not glass light base
  });
  it("shader spec with background:transparent still returns null (transparent wins)", () => {
    const css = backgroundCss({ ...SAMPLE_SPEC, shader: "aurora", background: "transparent" });
    expect(css).toBeNull();
  });
});
