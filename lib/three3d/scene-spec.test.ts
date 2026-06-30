import { describe, it, expect } from "vitest";
import { coerceSceneSpec, parseSceneSpecStrict, SAMPLE_SPEC } from "./scene-spec";

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
