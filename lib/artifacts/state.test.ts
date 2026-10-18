// @vitest-environment node
import { describe, expect, it } from "vitest";
import { artifactProgress, validateArtifactFiles, validateArtifactOutputs } from "./state";

describe("artifact boundaries", () => {
  it("refuses source traversal and files that would leave the artifact workspace", () => {
    for (const path of ["../app.tsx", "/index.html", "a/../../secret", "a\\..\\x", "a//b", "constructor", "__proto__", "a\u0000b"]) {
      expect(() => validateArtifactFiles({ [path]: "x" })).toThrow();
    }
    expect(validateArtifactFiles({ "src/main.tsx": "export default 1", "deck.json": "{}" })).toEqual({ "src/main.tsx": "export default 1", "deck.json": "{}" });
  });

  it("never accepts empty or unverifiable exported files as completed output", () => {
    expect(() => validateArtifactOutputs([])).toThrow();
    const good = { key: "p/a/1/output.pdf", hash: "a".repeat(64), mime: "application/pdf", bytes: 123, format: "pdf" };
    expect(() => validateArtifactOutputs([{ ...good, bytes: 0 }])).toThrow();
    expect(() => validateArtifactOutputs([{ ...good, key: "https://public.test/a.pdf" }])).toThrow();
    expect(validateArtifactOutputs([good])).toEqual([good]);
  });

  it("counts five pieces independently and does not erase four successes after a failed video", () => {
    expect(artifactProgress([
      { currentRevision: 1, lastReadyRevision: 1, status: "ready" },
      { currentRevision: 1, lastReadyRevision: 1, status: "ready" },
      { currentRevision: 1, lastReadyRevision: 1, status: "ready" },
      { currentRevision: 1, lastReadyRevision: 1, status: "ready" },
      { currentRevision: 1, lastReadyRevision: null, status: "failed" },
    ])).toEqual({ total: 5, ready: 4, pending: 0, active: 0, failed: 1 });
  });
});
