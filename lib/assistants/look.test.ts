import { describe, expect, it } from "vitest";

import { DEFAULT_LOOK } from "@/lib/figure/look";

import { lookOfRow } from "./look";

const LOOK = { v: 1, shape: "heart", color: "#19c3b1", eyes: "round", eyewear: "none", accessory: "crown" } as const;

describe("lookOfRow", () => {
  it("is the saved look when it checks", () => {
    expect(lookOfRow({ look: LOOK, color: "#19c3b1" })).toEqual(LOOK);
  });

  it("a row from before the figures wears the default look in its own color", () => {
    expect(lookOfRow({ look: null, color: "#5FB8A6" })).toEqual({ ...DEFAULT_LOOK, color: "#5fb8a6" });
    expect(lookOfRow({ color: "#5FB8A6" })).toEqual({ ...DEFAULT_LOOK, color: "#5fb8a6" });
  });

  it("never throws: what checks nowhere is the default look", () => {
    expect(lookOfRow({ look: { v: 2 }, color: "nope" })).toEqual(DEFAULT_LOOK);
    expect(lookOfRow({ look: "<script>", color: "transparent" })).toEqual(DEFAULT_LOOK);
  });
});
