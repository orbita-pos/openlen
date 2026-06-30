import { describe, it, expect } from "vitest";
import { generateSceneSpec, applyInputOverrides, resolveProvider } from "./generate-spec";
import { SAMPLE_SPEC } from "./scene-spec";

describe("resolveProvider", () => {
  it("defaults to mock, honors explicit + env=gemini", () => {
    expect(resolveProvider()).toBe("mock");
    expect(resolveProvider({ provider: "gemini" })).toBe("gemini");
  });
});

describe("applyInputOverrides", () => {
  it("applies accent + behavior + look when given", () => {
    const out = applyInputOverrides(SAMPLE_SPEC, { describe: "x", accent: "#00FF88", brandMatch: true, behavior: "still", look: "studio" });
    expect(out.material.colors[0]).toBe("#00FF88");
    expect(out.material.accentLinked).toBe(true);
    expect(out.motion.kind).toBe("still");
    expect(out.look).toBe("studio");
  });
  it("does not apply accent when brandMatch is false", () => {
    const out = applyInputOverrides(SAMPLE_SPEC, { describe: "x", accent: "#00FF88", brandMatch: false });
    expect(out.material.colors[0]).not.toBe("#00FF88");
  });
});

describe("generateSceneSpec (mock)", () => {
  it("returns an injected devSpec verbatim (coerced) in mock", async () => {
    const r = await generateSceneSpec({ describe: "anything", devSpec: { ...SAMPLE_SPEC, look: "neutral" } }, { provider: "mock" });
    expect(r.provider).toBe("mock");
    expect(r.spec.look).toBe("neutral");
    expect(r.fallback).toBe(false);
  });
  it("falls back to the nearest golden when no devSpec, applying accent", async () => {
    const r = await generateSceneSpec({ describe: "un anillo de oro girando", accent: "#123456", brandMatch: true }, { provider: "mock" });
    expect(r.provider).toBe("mock");
    expect(r.spec.geometry.kind).toBe("torus");
    expect(r.spec.material.colors[0]).toBe("#123456");
  });
  it("never throws on junk describe in mock", async () => {
    const r = await generateSceneSpec({ describe: "" }, { provider: "mock" });
    expect(r.spec.version).toBe(1);
  });
});
