import { describe, expect, it } from "vitest";

import { WindowLimiter } from "./window-limiter";

describe("WindowLimiter", () => {
  it("lets max hits through per window, then says how long to wait", () => {
    let t = 0;
    const l = new WindowLimiter(() => t);
    const rules = [{ windowMs: 60_000, max: 2 }];
    expect(l.hit("a", rules)).toBe(0);
    expect(l.hit("a", rules)).toBe(0);
    t = 15_000;
    expect(l.hit("a", rules)).toBe(45_000);
    expect(l.hit("b", rules)).toBe(0);
    t = 60_000;
    expect(l.hit("a", rules)).toBe(0);
  });

  it("every window must have room, and a refused hit counts in none", () => {
    let t = 0;
    const l = new WindowLimiter(() => t);
    const rules = [
      { windowMs: 1_000, max: 1 },
      { windowMs: 10_000, max: 2 },
    ];
    expect(l.hit("k", rules)).toBe(0);
    expect(l.hit("k", rules)).toBe(1_000); // the short window is full
    t = 1_000;
    expect(l.hit("k", rules)).toBe(0); // the refused one did not count in the long window
    t = 2_000;
    expect(l.hit("k", rules)).toBe(8_000); // now the long one is full
  });
});
