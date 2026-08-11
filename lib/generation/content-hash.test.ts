import { describe, expect, it } from "vitest";

import { canonicalJsonSha256, sha256 } from "./content-hash";

describe("content hash helpers", () => {
  it("preserves the SHA-256 wire format used by generation metadata", () => {
    expect(sha256("abc")).toBe(
      "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("canonicalizes object keys before hashing", () => {
    const expected = "sha256:43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777";
    expect(canonicalJsonSha256({ b: 2, a: 1 })).toBe(expected);
    expect(canonicalJsonSha256({ a: 1, b: 2 })).toBe(expected);
  });
});
