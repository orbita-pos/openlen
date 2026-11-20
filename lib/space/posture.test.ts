// LEN IN THE PERSON'S SPACE (spec local 2026-11-19-agentes-para-todos, §6.3): the space has no pages; Len makes and
// changes the person's agents there, with the agent-creation skill. Every other prompt stays byte for byte.
import { describe, expect, it } from "vitest";

import { buildAgentSystemPrompt } from "@/lib/agent/catalog";

import { SPACE_POSTURE, promptOfSpace } from "./posture";

describe("the space posture", () => {
  it("goes after the prompt and names the agent-creation skill", () => {
    const p = promptOfSpace("LEN PROMPT");
    expect(p.startsWith("LEN PROMPT\n\n")).toBe(true);
    expect(p).toContain(SPACE_POSTURE);
    expect(SPACE_POSTURE).toContain("agent-creation");
  });

  it("only in the space: a page's prompt is the one it always was", () => {
    const page = buildAgentSystemPrompt({}, "len", null, false, false);
    expect(buildAgentSystemPrompt({}, "len", null, false, false, false)).toBe(page);
    const space = buildAgentSystemPrompt({}, "len", null, false, false, true);
    expect(space).toBe(promptOfSpace(page));
  });
});
