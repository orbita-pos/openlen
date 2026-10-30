import { describe, expect, it } from "vitest";

import { lenWatchEnabled } from "./enabled";

describe("lenWatchEnabled", () => {
  it("is on unless OPENLEN_WATCH is the literal 0", () => {
    expect(lenWatchEnabled({})).toBe(true);
    expect(lenWatchEnabled({ OPENLEN_WATCH: "1" })).toBe(true);
    expect(lenWatchEnabled({ OPENLEN_WATCH: "0" })).toBe(false);
  });
});
