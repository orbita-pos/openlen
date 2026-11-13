// @vitest-environment node
import { describe, expect, it } from "vitest";

import { isCompactionMark } from "./mark";

describe("A11 · what a stored compaction mark looks like", () => {
  const mark = {
    messages: [{ role: "user", content: "<compacted-summary>\nx\n</compacted-summary>" }],
    fromTranscript: 0,
    trigger: "manual",
    preTokens: 10,
    postTokens: 5,
  };
  it("🔴 a mark read back from jsonb is recognized", () => {
    expect(isCompactionMark(mark)).toBe(true);
    expect(isCompactionMark({ ...mark, trigger: "overflow" })).toBe(true);
    expect(isCompactionMark({ ...mark, skills: ["office-xlsx"] })).toBe(true);
  });
  // THE IDLE SUMMARY (piece B): written while the conversation sat idle, promoted when a turn comes back cold.
  it("a mark written while idle is a mark", () => {
    expect(isCompactionMark({ ...mark, trigger: "idle", skills: [] })).toBe(true);
  });
  it("anything else is not: null, no messages, an unknown trigger, a negative index", () => {
    expect(isCompactionMark(null)).toBe(false);
    expect(isCompactionMark({ ...mark, messages: [] })).toBe(false);
    expect(isCompactionMark({ ...mark, trigger: "auto" })).toBe(false);
    expect(isCompactionMark({ ...mark, fromTranscript: -1 })).toBe(false);
    expect(isCompactionMark({ ...mark, skills: [1] })).toBe(false);
  });
});
