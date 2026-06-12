// Gates for the gradient editor's round-trip model: what we build must parse
// back identically, what getComputedStyle emits (rgb() stops) must parse, and
// anything we couldn't faithfully re-edit must be refused.
import { describe, it, expect } from "vitest";
import {
  buildLinearGradient,
  buildRadialGradient,
  gradientBgPlan,
  hexLuminance,
  parseSimpleGradient,
} from "./gradients";

describe("build + parse round-trip", () => {
  it("linear with angle", () => {
    const css = buildLinearGradient(135, ["#0a0f1e", "#1e293b"]);
    expect(css).toBe("linear-gradient(135deg, #0a0f1e, #1e293b)");
    expect(parseSimpleGradient(css)).toEqual({
      type: "linear",
      angle: 135,
      stops: ["#0a0f1e", "#1e293b"],
    });
  });
  it("radial", () => {
    const css = buildRadialGradient(["#ffffff", "#0ea5e9"]);
    expect(parseSimpleGradient(css)).toEqual({
      type: "radial",
      angle: 180,
      stops: ["#ffffff", "#0ea5e9"],
    });
  });
  it("normalizes angle wrap", () => {
    expect(buildLinearGradient(450, ["#000000", "#ffffff"])).toContain(
      "(90deg",
    );
    expect(buildLinearGradient(-90, ["#000000", "#ffffff"])).toContain(
      "(270deg",
    );
  });
});

describe("parseSimpleGradient — computed forms + rejections", () => {
  it("parses the rgb() form getComputedStyle emits", () => {
    expect(
      parseSimpleGradient(
        "linear-gradient(135deg, rgb(10, 15, 30), rgb(30, 41, 59))",
      ),
    ).toEqual({ type: "linear", angle: 135, stops: ["#0a0f1e", "#1e293b"] });
  });
  it("parses stop positions + rgba alpha + 3-char hex", () => {
    expect(
      parseSimpleGradient(
        "linear-gradient(90deg, rgba(255, 0, 0, 0.5) 0%, #0f0 100%)",
      ),
    ).toEqual({ type: "linear", angle: 90, stops: ["#ff0000", "#00ff00"] });
  });
  it("defaults the angle when linear has only stops", () => {
    expect(parseSimpleGradient("linear-gradient(#ffffff, #000000)")?.angle).toBe(
      180,
    );
  });
  it("rejects keyword directions, 3+ stops, conic, url layers, layer lists", () => {
    expect(parseSimpleGradient("linear-gradient(to right, #fff, #000)")).toBeNull();
    expect(
      parseSimpleGradient("linear-gradient(90deg, #fff, #888, #000)"),
    ).toBeNull();
    expect(parseSimpleGradient("conic-gradient(#fff, #000)")).toBeNull();
    expect(
      parseSimpleGradient(
        'linear-gradient(rgba(0,0,0,.4), rgba(0,0,0,.4)), url("/x.webp")',
      ),
    ).toBeNull();
    expect(
      parseSimpleGradient(
        "linear-gradient(0deg, #fff, #000), linear-gradient(90deg, #000, #fff)",
      ),
    ).toBeNull();
    expect(parseSimpleGradient("")).toBeNull();
    expect(parseSimpleGradient("none")).toBeNull();
  });
});

describe("hexLuminance", () => {
  it("handles hex and rgb() inputs", () => {
    expect(hexLuminance("#000000")).toBe(0);
    expect(hexLuminance("rgb(255, 255, 255)")).toBeCloseTo(1, 5);
    expect(hexLuminance("garbage")).toBe(0.5);
  });
});

describe("gradientBgPlan", () => {
  it("dark stops → white ink; never a scrim", () => {
    const p = gradientBgPlan(["#0a0f1e", "#1e293b"]);
    expect(p.ink).toBe("#ffffff");
    expect(p.scrimColor).toBe("");
    expect(p.groundLum).toBeLessThan(0.1);
  });
  it("light stops → dark ink", () => {
    expect(gradientBgPlan(["#f8fafc", "#e2e8f0"]).ink).toBe("#111827");
  });
  it("mid ground picks the higher-contrast ink", () => {
    // #808080 lum ≈ 0.216: white cr ≈ 3.95 vs dark cr ≈ 4.27 → dark wins.
    expect(gradientBgPlan(["#808080", "#808080"]).ink).toBe("#111827");
  });
});
