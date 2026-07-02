import { describe, it, expect } from "vitest";
import { SHADER_VERT, shaderFragment, SHADER_VARIANT_KEYS } from "./shaders";

const EXPECTED_KEYS = ["gradient", "fluid", "aurora", "plasma", "ember", "dots", "silk"];

describe("SHADER_VARIANT_KEYS", () => {
  it("has all 7 shader variants", () => {
    expect(SHADER_VARIANT_KEYS.length).toBe(7);
    for (const k of EXPECTED_KEYS) expect(SHADER_VARIANT_KEYS).toContain(k);
  });
});

describe("SHADER_VERT", () => {
  it("is the shared fullscreen passthrough vertex shader", () => {
    expect(SHADER_VERT).toContain("varying vec2 vUv");
    expect(SHADER_VERT).toContain("gl_Position");
  });
});

describe("shaderFragment", () => {
  it("gradient contains the shared precision header", () => {
    expect(shaderFragment("gradient")).toContain("precision highp float");
  });

  it("every known variant compiles a highp fragment", () => {
    for (const k of SHADER_VARIANT_KEYS) {
      expect(shaderFragment(k)).toContain("precision highp float");
    }
  });

  it("noise-composed variants retain the fbm composition (gradient/aurora/silk/ember/dots)", () => {
    expect(shaderFragment("gradient")).toContain("float fbm(");
    expect(shaderFragment("aurora")).toContain("float fbm(");
    expect(shaderFragment("silk")).toContain("float fbm(");
    expect(shaderFragment("ember")).toContain("float fbm(");
    expect(shaderFragment("dots")).toContain("float fbm(");
  });

  it("noise-free variants do not carry the fbm helper (fluid/plasma)", () => {
    expect(shaderFragment("fluid")).not.toContain("float fbm(");
    expect(shaderFragment("plasma")).not.toContain("float fbm(");
  });

  it("falls back to the gradient fragment for an unknown variant, matching mount.ts's prior `?? GRADIENT` behavior", () => {
    expect(shaderFragment("not-a-real-variant")).toBe(shaderFragment("gradient"));
  });
});
