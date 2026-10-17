import { describe, expect, it } from "vitest";
import { createWidgetOffsets } from "./widget-offsets";

describe("createWidgetOffsets — where each visual of a turn goes in the text", () => {
  it("a visual starts where the text was at its first chunk, and its card takes that point", () => {
    const o = createWidgetOffsets();
    expect(o.preview(0, 3)).toBe(3);
    expect(o.preview(0, 3)).toBe(3);
    expect(o.card(3)).toBe(3);
  });

  it("a later round's visual, whose callIndex is 0 again, starts at its own point", () => {
    const o = createWidgetOffsets();
    o.preview(0, 3);
    o.card(3);
    expect(o.preview(0, 7)).toBe(7);
    expect(o.card(7)).toBe(7);
  });

  it("two visuals of the same round each keep their start, in order", () => {
    const o = createWidgetOffsets();
    expect(o.preview(0, 3)).toBe(3);
    expect(o.preview(1, 3)).toBe(3);
    expect(o.card(3)).toBe(3);
    expect(o.card(3)).toBe(3);
  });

  it("a card without a preview takes the text written so far", () => {
    expect(createWidgetOffsets().card(4)).toBe(4);
  });
});
