import { describe, expect, it } from "vitest";
import { FIGURE_COLORS, checkLook } from "./look";
import { curatedLook } from "./random";

describe("curatedLook", () => {
  it("gives the same figure for the same seed", () => {
    expect(curatedLook(7)).toEqual(curatedLook(7));
  });

  it("only gives valid looks in suggested colors, and varied ones", () => {
    const shapes = new Set<string>();
    const accessories = new Set<string>();
    for (let seed = 0; seed < 200; seed++) {
      const look = curatedLook(seed);
      expect(checkLook(look)).toEqual({ ok: true, value: look });
      expect(FIGURE_COLORS).toContain(look.color);
      shapes.add(look.shape);
      accessories.add(look.accessory);
    }
    expect(shapes.size).toBeGreaterThanOrEqual(5);
    expect(accessories.size).toBeGreaterThanOrEqual(4);
  });

  it("never hides a smile or sleepy eyes behind shades", () => {
    for (let seed = 0; seed < 200; seed++) {
      const look = curatedLook(seed);
      if (look.eyewear === "shades") expect(["smile", "sleepy"]).not.toContain(look.eyes);
    }
  });
});
