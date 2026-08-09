import { describe, expect, it } from "vitest";
import { parseVisualRepairMode } from "./visual-repair-mode";

describe("parseVisualRepairMode", () => {
  it.each([[undefined, "off"], ["off", "off"], ["shadow", "shadow"], ["on", "on"], ["true", "off"], ["ON", "off"]] as const)("maps %s to %s", (raw, expected) => {
    expect(parseVisualRepairMode(raw)).toBe(expected);
  });
});
