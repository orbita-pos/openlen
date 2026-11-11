import { describe, expect, it } from "vitest";
import { TIERS, nextTier } from "./quality";

describe("the quality tiers", () => {
  it("grow in layers and resolution, up to twice the CSS size", () => {
    expect(TIERS).toHaveLength(3);
    for (let i = 1; i < TIERS.length; i++) {
      expect(TIERS[i]!.layers).toBeGreaterThan(TIERS[i - 1]!.layers);
      expect(TIERS[i]!.pixelRatio).toBeGreaterThan(TIERS[i - 1]!.pixelRatio);
    }
    expect(TIERS[2]!.pixelRatio).toBe(2);
  });
});

describe("nextTier", () => {
  it("steps down when frames are slow, and gives up below the lowest", () => {
    expect(nextTier(2, 30, 1)).toBe(1);
    expect(nextTier(1, 30, 1)).toBe(0);
    expect(nextTier(0, 40, 1)).toBe("flat");
  });

  it("only steps up after staying comfortably fast for a while", () => {
    expect(nextTier(1, 8, 1)).toBe(1);
    expect(nextTier(1, 8, 4)).toBe(1);
    expect(nextTier(1, 8, 5)).toBe(2);
    expect(nextTier(0, 8, 5)).toBe(1);
    expect(nextTier(2, 8, 50)).toBe(2);
  });

  it("has a dead zone, so it does not swing back and forth", () => {
    expect(nextTier(2, 17, 9)).toBe(2);
    expect(nextTier(1, 14, 9)).toBe(1);
    expect(nextTier(0, 20, 9)).toBe(0);
  });

  it("lets a nonsense measurement decide nothing", () => {
    for (const ms of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0]) expect(nextTier(2, ms, 9)).toBe(2);
  });
});
