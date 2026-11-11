import { describe, expect, it } from "vitest";
import { TIERS, isSlow, median, nextTier } from "./quality";

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

describe("median", () => {
  it("is the middle value, whatever the order", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([16.7, 16.7, 240, 16.7, 16.7])).toBe(16.7);
    expect(median([])).toBeNaN();
  });
});

describe("isSlow", () => {
  it("is not slow on a screen that simply refreshes 30 times a second (a phone saving battery)", () => {
    expect(isSlow(33.3, 33.3)).toBe(false);
  });

  it("is slow when it draws at half of what the screen can show", () => {
    expect(isSlow(33.3, 16.7)).toBe(true);
    expect(isSlow(16.7, 8.3)).toBe(true);
  });

  it("is not slow at the screen's own pace, with some jitter", () => {
    expect(isSlow(16.7, 16.7)).toBe(false);
    expect(isSlow(18.5, 16.7)).toBe(false);
    expect(isSlow(8.3, 8.3)).toBe(false);
  });

  it("is slow under twenty frames a second, whatever the screen", () => {
    expect(isSlow(60, 60)).toBe(true);
    expect(isSlow(250, 250)).toBe(true);
  });

  it("lets a nonsense measurement decide nothing", () => {
    for (const ms of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0]) {
      expect(isSlow(ms, 16.7)).toBe(false);
      expect(isSlow(30, ms)).toBe(false);
    }
  });
});

describe("nextTier", () => {
  it("needs two slow windows in a row to step down: one hiccup is not the device", () => {
    expect(nextTier(2, 1)).toBe(2);
    expect(nextTier(2, 2)).toBe(1);
    expect(nextTier(1, 2)).toBe(0);
  });

  it("gives up below the lowest tier", () => {
    expect(nextTier(0, 1)).toBe(0);
    expect(nextTier(0, 2)).toBe("flat");
  });

  it("stays where it is while nothing is slow, and never steps back up", () => {
    for (const tier of [0, 1, 2] as const) expect(nextTier(tier, 0)).toBe(tier);
  });
});
