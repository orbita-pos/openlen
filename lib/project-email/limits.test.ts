import { describe, expect, it } from "vitest";

import { EMAIL_LIMITS, EXTRA_CENTICREDITS_PER_EMAIL, monthOf, RESEND_COST_USD_PER_EMAIL } from "./limits";

describe("project email limits (spec 0.4, approved by Jesús on 22/10)", () => {
  it("each paid plan's allowance and hourly caps", () => {
    expect(EMAIL_LIMITS).toEqual({
      pro: { includedPerMonth: 1_000, perHourApp: 100, perHourAuth: 500 },
      max: { includedPerMonth: 3_000, perHourApp: 300, perHourAuth: 3_000 },
      ultra: { includedPerMonth: 10_000, perHourApp: 1_000, perHourAuth: 10_000 },
    });
  });

  it("past the allowance, 150 credits per 1,000 emails; Resend's cost per email", () => {
    expect(EXTRA_CENTICREDITS_PER_EMAIL * 1_000).toBe(150 * 100);
    expect(RESEND_COST_USD_PER_EMAIL).toBe(0.0009);
  });

  it("the month is the calendar month in UTC", () => {
    expect(monthOf(new Date("2026-10-31T23:59:59Z"))).toBe("2026-10");
    expect(monthOf(new Date("2026-11-01T00:00:00Z"))).toBe("2026-11");
  });
});
