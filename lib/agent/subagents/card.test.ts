import { describe, expect, it } from "vitest";

import { subagentRefFrom } from "./card";

describe("a launch card's run, cleaned", () => {
  it("keeps an id and a preset", () => {
    expect(subagentRefFrom({ id: "3f2c-r1", preset: "Explore" })).toEqual({ id: "3f2c-r1", preset: "Explore" });
  });

  it("drops anything else, and what is not that shape", () => {
    expect(subagentRefFrom({ id: "r1", preset: "Plan", extra: 1 })).toEqual({ id: "r1", preset: "Plan" });
    expect(subagentRefFrom({ id: "r1" })).toBeNull();
    expect(subagentRefFrom({ id: "../x", preset: "Plan" })).toBeNull();
    expect(subagentRefFrom({ id: "r1", preset: "<b>" })).toBeNull();
    expect(subagentRefFrom("r1")).toBeNull();
    expect(subagentRefFrom(null)).toBeNull();
  });
});
