// Unit tests for Subsystem A pure helpers (jsdom).
import { describe, it, expect } from "vitest";
import { isThreeDTransform, rowsOverlap } from "./transform-composition";

describe("isThreeDTransform", () => {
  it("detects matrix3d (rotateY flips/tilts compute to this)", () => {
    expect(isThreeDTransform("matrix3d(-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)")).toBe(true);
    expect(isThreeDTransform("matrix3d(0.994, 0, 0.104, 0, 0, 1, 0, 0, -0.104, 0, 0.994, 0, 0, 0, 0, 1)")).toBe(true);
  });
  it("detects authored 3D functions", () => {
    expect(isThreeDTransform("rotateY(15deg)")).toBe(true);
    expect(isThreeDTransform("perspective(800px) rotateX(10deg)")).toBe(true);
    expect(isThreeDTransform("translate3d(0,0,4px)")).toBe(true);
  });
  it("does NOT flag 2D transforms or none (overlay self-correct handles those)", () => {
    expect(isThreeDTransform("none")).toBe(false);
    expect(isThreeDTransform("")).toBe(false);
    expect(isThreeDTransform(null)).toBe(false);
    expect(isThreeDTransform("matrix(1, 0, 0, 1, 40, 0)")).toBe(false);
    expect(isThreeDTransform("translate(8px, 4px)")).toBe(false);
  });
});

describe("rowsOverlap", () => {
  const orig = [{ top: 298, left: 902 }, { top: 317, left: 905 }];
  it("accepts an in-context clone within tolerance (~1px observed)", () => {
    expect(rowsOverlap(orig, [{ top: 298, left: 903 }, { top: 317, left: 906 }], 1.5)).toBe(true);
  });
  it("rejects a flat overlay that misses the 3D projection (far off)", () => {
    expect(rowsOverlap(orig, [{ top: 298, left: -1174 }, { top: 317, left: -1171 }], 1.5)).toBe(false);
  });
  it("rejects a different line count", () => {
    expect(rowsOverlap(orig, [{ top: 298, left: 902 }], 1.5)).toBe(false);
  });
  it("rejects empties", () => {
    expect(rowsOverlap([], [], 1.5)).toBe(false);
  });
  it("is absolute (does NOT re-align the first row, unlike rowsMatch)", () => {
    // shifted by +5,+5 uniformly → still rejected (we need true overlap)
    expect(rowsOverlap(orig, [{ top: 303, left: 907 }, { top: 322, left: 910 }], 1.5)).toBe(false);
  });
});
