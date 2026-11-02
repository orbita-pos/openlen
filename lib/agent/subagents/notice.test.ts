import { describe, expect, it } from "vitest";

import { settlementNotice, startedLine } from "./notice";

describe("what Len reads about a subagent (DeepSeek's words)", () => {
  it("starting one answers with its id", () => {
    expect(startedLine("abc")).toBe("started subagent abc");
  });

  it("a finished one carries its closing message", () => {
    expect(settlementNotice({ id: "abc", stopReason: "completed", closingText: "Found it in /menu/index.html:12." })).toBe(
      "Background subagent abc finished. It cannot receive follow-up messages.\n\nIts closing message:\nFound it in /menu/index.html:12.",
    );
  });

  it("a stopped one with nothing to say says so", () => {
    expect(settlementNotice({ id: "abc", stopReason: "aborted", closingText: "" })).toBe(
      "Background subagent abc was stopped before it finished.\n\nIt left no closing message.",
    );
  });

  it("a failed one carries the safe error code apart", () => {
    expect(settlementNotice({ id: "abc", stopReason: "error", closingText: "", diagnostic: "provider_unavailable" })).toBe(
      "Background subagent abc failed before it finished.\n\nIt left no closing message.\n\nprovider_unavailable",
    );
  });

  it("one cut by the turn's spending limit says it is partial", () => {
    expect(settlementNotice({ id: "abc", stopReason: "budget", closingText: "Partial: two of three pages read." })).toBe(
      "Background subagent abc stopped at the turn's spending limit before it finished.\n\nIts closing message:\nPartial: two of three pages read.",
    );
  });

  it("blank closing text counts as none", () => {
    expect(settlementNotice({ id: "abc", stopReason: "completed", closingText: "  \n" })).toBe(
      "Background subagent abc finished. It cannot receive follow-up messages.\n\nIt left no closing message.",
    );
  });
});
