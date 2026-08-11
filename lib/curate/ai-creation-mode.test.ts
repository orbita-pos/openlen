import { describe, expect, it } from "vitest";

import { aiCreationMode } from "./ai-creation-mode";

describe("aiCreationMode", () => {
  it.each([
    [undefined, "disabled"],
    ["", "disabled"],
    ["ENABLED", "disabled"],
    [" enabled", "disabled"],
    ["enabled", "enabled"],
  ] as const)("maps %s to %s", (raw, expected) => {
    expect(aiCreationMode(raw)).toBe(expected);
  });
});
