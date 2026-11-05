// @vitest-environment node
import { describe, expect, it } from "vitest";

import { gamesEnabled } from "./enabled";

describe("gamesEnabled", () => {
  it("is on by default and only the literal \"0\" turns it off, like tools", () => {
    expect(gamesEnabled({})).toBe(true);
    expect(gamesEnabled({ OPENLEN_GAMES: "0" })).toBe(false);
    expect(gamesEnabled({ OPENLEN_GAMES: "false" })).toBe(true);
  });
});
