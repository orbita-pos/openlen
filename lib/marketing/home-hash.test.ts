// Old links to the home's anchors (spec local 2026-11-06-portada-solo-input): `#pricing` and `#features` used to be
// sections of the home; now they are pages. `#ask` is how a page without the box sends you to the home's box.
import { describe, expect, it } from "vitest";
import { homeHashAction } from "./home-hash";

describe("what the home does with the hash it arrives with", () => {
  it("the old section anchors go to their pages", () => {
    expect(homeHashAction("#pricing")).toEqual({ kind: "go", path: "/pricing" });
    expect(homeHashAction("#features")).toEqual({ kind: "go", path: "/features" });
  });

  it("#ask focuses the box", () => {
    expect(homeHashAction("#ask")).toEqual({ kind: "focus", id: "hero-prompt" });
  });

  it("anything else does nothing, and the match is exact", () => {
    expect(homeHashAction("")).toBeNull();
    expect(homeHashAction("#")).toBeNull();
    expect(homeHashAction("#other")).toBeNull();
    expect(homeHashAction("#PRICING")).toBeNull();
  });
});
