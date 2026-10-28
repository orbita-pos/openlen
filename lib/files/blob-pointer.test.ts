import { describe, expect, it } from "vitest";

import { makePointer, textFilesOnly } from "./blob-pointer";

describe("textFilesOnly", () => {
  it("leaves the binaries out (what reads code, like the security review, has nothing to read in them)", () => {
    const p = makePointer({ sha256: "a".repeat(64), size: 3, gitOid: "b".repeat(40) });
    expect(textFilesOnly({ "/a.js": "x", "/img/a.png": p })).toEqual({ "/a.js": "x" });
  });
});
