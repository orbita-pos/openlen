import { describe, expect, it } from "vitest";

import { figuresEnabled } from "./enabled";

describe("figuresEnabled", () => {
  it("is on unless OPENLEN_FIGURES is exactly 0", () => {
    expect(figuresEnabled({})).toBe(true);
    expect(figuresEnabled({ OPENLEN_FIGURES: "1" })).toBe(true);
    expect(figuresEnabled({ OPENLEN_FIGURES: "false" })).toBe(true);
    expect(figuresEnabled({ OPENLEN_FIGURES: "0" })).toBe(false);
  });
});
