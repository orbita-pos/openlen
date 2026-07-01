import { describe, it, expect } from "vitest";
import { coerceSceneSpec, parseSceneSpecStrict, SAMPLE_SPEC, SHADER_VARIANTS } from "./scene-spec";

describe("coerceSceneSpec", () => {
  it("returns a full valid spec from empty input", () => {
    const s = coerceSceneSpec({});
    expect(s.version).toBe(1);
    expect(s.geometry.kind).toBe("sphere");
    expect(s.material.kind).toBeTypeOf("string");
    expect(s.motion.speed).toBeGreaterThanOrEqual(0);
    expect(s.motion.speed).toBeLessThanOrEqual(1);
  });

  it("clamps out-of-range numbers into 0..1", () => {
    const s = coerceSceneSpec({ geometry: { kind: "torus", params: { scale: 9, detail: -3, distort: 0.5, density: 2 } } });
    expect(s.geometry.kind).toBe("torus");
    expect(s.geometry.params.scale).toBe(1);
    expect(s.geometry.params.detail).toBe(0);
    expect(s.geometry.params.distort).toBe(0.5);
    expect(s.geometry.params.density).toBe(1);
  });

  it("snaps unknown enum values to safe defaults", () => {
    const s = coerceSceneSpec({ geometry: { kind: "dragon" }, material: { kind: "plasma" }, look: "rave" });
    expect(s.geometry.kind).toBe("sphere");
    expect(s.material.kind).toBe("matte");
    expect(s.look).toBe("soft");
  });

  it("preserves a valid sample round-trip", () => {
    expect(coerceSceneSpec(SAMPLE_SPEC)).toEqual(SAMPLE_SPEC);
  });

  it("never throws on non-object inputs", () => {
    for (const bad of ["hello", 42, [], true, null, undefined]) {
      expect(() => coerceSceneSpec(bad as unknown)).not.toThrow();
      const s = coerceSceneSpec(bad as unknown);
      expect(s.version).toBe(1);
      expect(s.geometry.kind).toBe("sphere");
    }
  });

  it("preserves shader:'aurora' through coerce", () => {
    const s = coerceSceneSpec({ ...SAMPLE_SPEC, shader: "aurora" });
    expect(s.shader).toBe("aurora");
  });

  it("spec without shader has shader === undefined", () => {
    const s = coerceSceneSpec(SAMPLE_SPEC);
    expect(s.shader).toBeUndefined();
  });

  it("coerces an invalid shader value to undefined without throwing", () => {
    const s = coerceSceneSpec({ ...SAMPLE_SPEC, shader: "lava" });
    expect(s.shader).toBeUndefined();
  });

  it("exports SHADER_VARIANTS with the 3 expected values", () => {
    expect(SHADER_VARIANTS).toEqual(["gradient", "fluid", "aurora"]);
  });

  it("preserves modelUrl through coerce round-trip", () => {
    const url = "http://localhost:1234/helmet.glb";
    const s = coerceSceneSpec({ ...SAMPLE_SPEC, modelUrl: url });
    expect(s.modelUrl).toBe(url);
  });

  it("spec without modelUrl has modelUrl === undefined", () => {
    const s = coerceSceneSpec(SAMPLE_SPEC);
    expect(s.modelUrl).toBeUndefined();
  });

  it("coerces a non-string modelUrl to undefined without throwing", () => {
    const s = coerceSceneSpec({ ...SAMPLE_SPEC, modelUrl: 42 });
    expect(s.modelUrl).toBeUndefined();
  });
});

describe("parseSceneSpecStrict", () => {
  it("accepts a fully-valid spec", () => {
    const r = parseSceneSpecStrict(SAMPLE_SPEC);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.geometry.kind).toBe("sphere");
  });
  it("rejects an unknown geometry kind", () => {
    const r = parseSceneSpecStrict({ ...SAMPLE_SPEC, geometry: { kind: "dragon", params: SAMPLE_SPEC.geometry.params } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/geometry|kind|dragon/i);
  });
  it("rejects a non-object", () => {
    expect(parseSceneSpecStrict("nope").ok).toBe(false);
  });
  it("rejects a missing material", () => {
    const { material, ...rest } = SAMPLE_SPEC as any;
    expect(parseSceneSpecStrict(rest).ok).toBe(false);
  });
});
