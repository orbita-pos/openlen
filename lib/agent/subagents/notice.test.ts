import { describe, expect, it } from "vitest";

import { agentMessage, LEN_AGENT_ID, settlementNotice, startedLine, withContinuableReturnGuidance } from "./notice";

describe("what Len reads about a subagent (DeepSeek's words, continuable form)", () => {
  it("starting one answers with its id", () => {
    expect(startedLine("abc")).toBe("started subagent abc");
  });

  it("a finished one will do no more unless Len sends it more, and carries its closing message", () => {
    expect(settlementNotice({ id: "abc", stopReason: "completed", closingText: "Found it in /menu/index.html:12." })).toBe(
      "Background subagent abc finished and will do no further work unless you send it more.\n\nIts closing message:\nFound it in /menu/index.html:12.",
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
      "Background subagent abc finished and will do no further work unless you send it more.\n\nIt left no closing message.",
    );
  });

  it("one that sent its result just before finishing has its closing message omitted", () => {
    expect(settlementNotice({ id: "abc", stopReason: "completed", closingText: "The same result again.", omitClosingText: true })).toBe(
      "Background subagent abc finished and will do no further work unless you send it more.\n\nIt sent you a message just before finishing, so its closing message is omitted.",
    );
  });
});

describe("messages between Len and his subagents (DeepSeek's words)", () => {
  it("Len is `len` to his children", () => {
    expect(LEN_AGENT_ID).toBe("len");
  });

  it("a message names who sent it", () => {
    expect(agentMessage("abc", "The menu is in /menu/index.html.")).toBe("Agent abc sent a message: The menu is in /menu/index.html.");
    expect(agentMessage(LEN_AGENT_ID, "Also check the footer.")).toBe("Agent len sent a message: Also check the footer.");
  });

  it("the child's task ends with how to send its result to its parent", () => {
    expect(withContinuableReturnGuidance("Find the menu.")).toBe(
      'Find the menu.\n\nYour parent agent id is "len". Before you finish, send your result to that agent with send_message({ agent_id: "len", message: "<self-contained result>" }). The parent shares your workspace but does not automatically receive your transcript, tool output, or reasoning. Send earlier messages as well when a finding changes what the parent should do next; sending a message does not end your turn.',
    );
  });
});

it("a turn-limited subagent reports its partial result", () => {
  expect(settlementNotice({ id: "abc", stopReason: "turn_limit" as never, closingText: "Read two pages." })).toBe("Background subagent abc stopped at its turn limit before it finished.\n\nIts closing message:\nRead two pages.");
});
