import { describe, expect, it } from "vitest";
import { formatBadge } from "./badge-format";

describe("formatBadge", () => {
  it("renders nothing at zero or below", () => {
    expect(formatBadge(0)).toBeNull();
    expect(formatBadge(-3)).toBeNull();
  });
  it("shows the number up to 99", () => {
    expect(formatBadge(1)).toBe("1");
    expect(formatBadge(99)).toBe("99");
  });
  it("caps at 99+", () => {
    expect(formatBadge(100)).toBe("99+");
    expect(formatBadge(1234)).toBe("99+");
  });
  it("never renders NaN or Infinity", () => {
    expect(formatBadge(Number.NaN)).toBeNull();
    expect(formatBadge(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
