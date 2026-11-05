// @vitest-environment node
//
// HOW A COLUMN'S VALUE READS IN A CONFIRMATION (option B of spec local 2026-11-04-herramientas-hechas-por-len, §4.4, and
// «Hazlo»'s data change): the person can only accept what they can read, so a jsonb value is JSON, not [object Object].
import { describe, expect, it } from "vitest";

import { changeValueText } from "./change-value-text";

describe("changeValueText", () => {
  it("a string as it is; a number or a boolean as text", () => {
    expect(changeValueText("confirmada")).toBe("confirmada");
    expect(changeValueText(4)).toBe("4");
    expect(changeValueText(false)).toBe("false");
  });
  it("nothing reads as ∅", () => {
    expect(changeValueText(null)).toBe("∅");
    expect(changeValueText(undefined)).toBe("∅");
  });
  it("an object or a list reads as JSON", () => {
    expect(changeValueText({ mesa: 4 })).toBe('{"mesa":4}');
    expect(changeValueText([1, "a"])).toBe('[1,"a"]');
  });
});
