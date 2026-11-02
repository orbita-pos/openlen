import { describe, expect, it } from "vitest";

import { createTurnSpend } from "./spend";

describe("the turn's spending limit, shared with its subagents", () => {
  it("running children count against each other and against Len, and settle into what they were charged", () => {
    const spend = createTurnSpend(1_000, () => 200);
    spend.track("r1", 400);
    expect(spend.over()).toBe(false);
    spend.track("r2", 400);
    expect(spend.over()).toBe(true);
    // r1 ends charged 100: its running 400 becomes a settled 100.
    spend.settle("r1", 100);
    expect(spend.children()).toBe(100);
    expect(spend.over()).toBe(false);
    expect(spend.over(300)).toBe(true);
  });

  it("a child's later report replaces its earlier one, it doesn't add up", () => {
    const spend = createTurnSpend(1_000, () => 0);
    spend.track("r1", 600);
    spend.track("r1", 700);
    expect(spend.over(299)).toBe(false);
    expect(spend.over(300)).toBe(true);
  });
});
