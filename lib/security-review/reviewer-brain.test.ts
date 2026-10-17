import { describe, expect, it } from "vitest";

import { reviewerBrainOptions } from "./reviewer-brain";

describe("the reviewer's brain", () => {
  it("is Len's, pinned to Fireworks (spec local 2026-10-16-second-provider §3.2)", () => {
    const signal = new AbortController().signal;
    const tools = [{ name: "Read" }];
    expect(reviewerBrainOptions({ tools, projectId: "p1", signal })).toEqual({
      tools,
      requestId: "security-review:p1",
      signal,
      esfuerzoDelTurno: "high",
      providers: ["fireworks"],
    });
  });
});
