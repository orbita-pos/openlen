import { describe, it, expect } from "vitest";
import { coerceSceneSpec, SAMPLE_SPEC } from "./scene-spec";

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
