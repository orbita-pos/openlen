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

describe("buildSceneConfig — quality fields", () => {
  it("carries geometry/material kind, cluster flag, exposure, envIntensity, accentColor", () => {
    const c = buildSceneConfig({ ...SAMPLE_SPEC, preset: "background", look: "dramatic" });
    expect(c.geometryKind).toBe(SAMPLE_SPEC.geometry.kind);
    expect(c.materialKind).toBe(SAMPLE_SPEC.material.kind);
    expect(c.cluster).toBe(true); // background → cluster
    expect(c.exposure).toBeGreaterThan(0);
    expect(c.envIntensity).toBeGreaterThan(0);
    expect(c.accentColor).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
  it("single object for accent preset", () => {
    expect(buildSceneConfig({ ...SAMPLE_SPEC, preset: "accent" }).cluster).toBe(false);
  });
});

describe("buildSceneConfig — model-path passthroughs", () => {
  it("exposes raw motion speed, independent of the geometry-path rotationSpeed formula", () => {
    const c = buildSceneConfig({ ...SAMPLE_SPEC, motion: { kind: "drift", speed: 0.9, amplitude: 0.5 } });
    expect(c.motionSpeed).toBe(0.9);
  });

  it("exposes raw look and camera framing for paths with their own mapping", () => {
    const c = buildSceneConfig({ ...SAMPLE_SPEC, look: "dramatic", camera: { framing: "wide" } });
    expect(c.look).toBe("dramatic");
    expect(c.framing).toBe("wide");
  });
});

describe("buildSceneConfig — accentLinked", () => {
  it("carries accentLinked=true from material", () => {
    const c = buildSceneConfig({ ...SAMPLE_SPEC, material: { ...SAMPLE_SPEC.material, accentLinked: true } });
    expect(c.accentLinked).toBe(true);
  });
  it("carries accentLinked=false from material", () => {
    const c = buildSceneConfig({ ...SAMPLE_SPEC, material: { ...SAMPLE_SPEC.material, accentLinked: false } });
    expect(c.accentLinked).toBe(false);
  });
});
