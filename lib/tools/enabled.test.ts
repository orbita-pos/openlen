// @vitest-environment node
import { describe, expect, it } from "vitest";

import { toolsEnabled } from "./enabled";

describe("toolsEnabled", () => {
  it("is on unless OPENLEN_TOOLS is the literal 0", () => {
    expect(toolsEnabled({})).toBe(true);
    expect(toolsEnabled({ OPENLEN_TOOLS: "1" })).toBe(true);
    expect(toolsEnabled({ OPENLEN_TOOLS: "0" })).toBe(false);
  });
});
