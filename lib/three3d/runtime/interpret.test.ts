import { describe, it, expect } from "vitest";
import { buildSceneConfig } from "./interpret";
import { SAMPLE_SPEC } from "../scene-spec";

describe("buildSceneConfig", () => {
  it("maps the sample spec to a renderable config", () => {
    const c = buildSceneConfig(SAMPLE_SPEC);
    expect(c.segments).toBeGreaterThan(8);
    expect(c.radius).toBeGreaterThan(0);
    expect(c.color).toBe("#7C5CFF");
    expect(c.rotationSpeed).toBeGreaterThan(0);
    expect(c.lights.length).toBeGreaterThanOrEqual(2);
    expect(c.cameraZ).toBeGreaterThan(0);
  });

  it("gives 'still' motion zero rotation", () => {
    const c = buildSceneConfig({ ...SAMPLE_SPEC, motion: { kind: "still", speed: 0.8, amplitude: 0.8 } });
    expect(c.rotationSpeed).toBe(0);
    expect(c.driftAmplitude).toBe(0);
  });

  it("each look produces a distinct lighting rig", () => {
    const studio = buildSceneConfig({ ...SAMPLE_SPEC, look: "studio" });
    const dramatic = buildSceneConfig({ ...SAMPLE_SPEC, look: "dramatic" });
    expect(studio.lights).not.toEqual(dramatic.lights);
  });

  it("falls back to a default color when colors[] is empty", () => {
    const c = buildSceneConfig({ ...SAMPLE_SPEC, material: { ...SAMPLE_SPEC.material, colors: [] } });
    expect(c.color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});
