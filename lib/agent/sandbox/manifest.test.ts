import { describe, expect, it } from "vitest";

import { diffManifests } from "./manifest";

describe("diffManifests", () => {
  it("diffs two manifests in path order", () => {
    expect(diffManifests({ "/b": "1", "/a": "1", "/c": "1" }, { "/a": "2", "/c": "1", "/d": "1" })).toEqual([
      { path: "/a", kind: "modified" },
      { path: "/b", kind: "deleted" },
      { path: "/d", kind: "added" },
    ]);
  });

  it("two equal manifests have no changes", () => {
    expect(diffManifests({ "/a": "1" }, { "/a": "1" })).toEqual([]);
  });

  it("orders by code unit, like the terminal's own changes", () => {
    expect(diffManifests({}, { "/b": "1", "/B": "1", "/a/z": "1", "/a.txt": "1" }).map((c) => c.path)).toEqual(["/B", "/a.txt", "/a/z", "/b"]);
  });
});
