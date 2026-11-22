// A VISUAL'S ID (spec local 2026-11-22-visuales-de-verdad, §2): the web, the phone and the server compute it the same way
// from the row that drew it and its place among that row's visuals, so what a screen reports names a visual the server
// can check. Claude Code's shape: `widget_` and 8 characters.
import { describe, expect, it } from "vitest";

import { WIDGET_ID_PATTERN, widgetIdOf } from "./widget-id";

describe("widgetIdOf", () => {
  it("is widget_ and 8 characters of [a-z0-9]", () => {
    expect(widgetIdOf("row-1", 0)).toMatch(WIDGET_ID_PATTERN);
    expect(widgetIdOf("2f6a1c0e-9b1d-4c3a-8f00-1234567890ab", 7)).toMatch(/^widget_[a-z0-9]{8}$/);
  });

  it("the same row and place give the same id, on any side", () => {
    expect(widgetIdOf("row-1", 0)).toBe(widgetIdOf("row-1", 0));
  });

  it("another place or another row gives another id", () => {
    const ids = new Set([widgetIdOf("row-1", 0), widgetIdOf("row-1", 1), widgetIdOf("row-2", 0), widgetIdOf("row-10", 0), widgetIdOf("row-1", 10)]);
    expect(ids.size).toBe(5);
  });
});
