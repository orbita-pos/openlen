// @vitest-environment node
import { describe, expect, it } from "vitest";

import { lenArtifactsEnabled } from "./enabled";

describe("lenArtifactsEnabled", () => {
  it("is on unless OPENLEN_LEN_ARTIFACTS is the literal 0", () => {
    expect(lenArtifactsEnabled({})).toBe(true);
    expect(lenArtifactsEnabled({ OPENLEN_LEN_ARTIFACTS: "1" })).toBe(true);
    expect(lenArtifactsEnabled({ OPENLEN_LEN_ARTIFACTS: "" })).toBe(true);
    expect(lenArtifactsEnabled({ OPENLEN_LEN_ARTIFACTS: "0" })).toBe(false);
  });

  it("reads the process environment when none is given", () => {
    const before = process.env.OPENLEN_LEN_ARTIFACTS;
    try {
      process.env.OPENLEN_LEN_ARTIFACTS = "0";
      expect(lenArtifactsEnabled()).toBe(false);
      delete process.env.OPENLEN_LEN_ARTIFACTS;
      expect(lenArtifactsEnabled()).toBe(true);
    } finally {
      if (before === undefined) delete process.env.OPENLEN_LEN_ARTIFACTS;
      else process.env.OPENLEN_LEN_ARTIFACTS = before;
    }
  });
});
