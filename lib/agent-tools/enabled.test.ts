// @vitest-environment node
import { describe, expect, it } from "vitest";

import { agentToolsEnabled } from "./enabled";

describe("agentToolsEnabled", () => {
  it("is on unless OPENLEN_AGENT_TOOLS is the literal 0", () => {
    expect(agentToolsEnabled({})).toBe(true);
    expect(agentToolsEnabled({ OPENLEN_AGENT_TOOLS: "1" })).toBe(true);
    expect(agentToolsEnabled({ OPENLEN_AGENT_TOOLS: "" })).toBe(true);
    expect(agentToolsEnabled({ OPENLEN_AGENT_TOOLS: "0" })).toBe(false);
  });

  it("reads the process environment when none is given", () => {
    const before = process.env.OPENLEN_AGENT_TOOLS;
    try {
      process.env.OPENLEN_AGENT_TOOLS = "0";
      expect(agentToolsEnabled()).toBe(false);
      delete process.env.OPENLEN_AGENT_TOOLS;
      expect(agentToolsEnabled()).toBe(true);
    } finally {
      if (before === undefined) delete process.env.OPENLEN_AGENT_TOOLS;
      else process.env.OPENLEN_AGENT_TOOLS = before;
    }
  });
});
