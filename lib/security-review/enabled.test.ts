import { describe, expect, it } from "vitest";

import { dailyBudgetCentiCredits, securityReviewEnabled } from "./enabled";

describe("securityReviewEnabled", () => {
  it("is on unless OPENLEN_SECURITY_REVIEW is exactly 0", () => {
    expect(securityReviewEnabled({})).toBe(true);
    expect(securityReviewEnabled({ OPENLEN_SECURITY_REVIEW: "1" })).toBe(true);
    expect(securityReviewEnabled({ OPENLEN_SECURITY_REVIEW: "" })).toBe(true);
    expect(securityReviewEnabled({ OPENLEN_SECURITY_REVIEW: "false" })).toBe(true);
    expect(securityReviewEnabled({ OPENLEN_SECURITY_REVIEW: "0" })).toBe(false);
  });
});

describe("dailyBudgetCentiCredits", () => {
  it("is $5 a day by default: 50,000 centicredits", () => {
    expect(dailyBudgetCentiCredits({})).toBe(50_000);
  });

  it("reads OPENLEN_SECURITY_REVIEW_DAILY_USD without losing a cent to floating point", () => {
    expect(dailyBudgetCentiCredits({ OPENLEN_SECURITY_REVIEW_DAILY_USD: "0.29" })).toBe(2_900);
    expect(dailyBudgetCentiCredits({ OPENLEN_SECURITY_REVIEW_DAILY_USD: "12" })).toBe(120_000);
    expect(dailyBudgetCentiCredits({ OPENLEN_SECURITY_REVIEW_DAILY_USD: "0" })).toBe(0);
  });

  it("falls back to the default on a value that isn't a sum of money", () => {
    expect(dailyBudgetCentiCredits({ OPENLEN_SECURITY_REVIEW_DAILY_USD: "abc" })).toBe(50_000);
    expect(dailyBudgetCentiCredits({ OPENLEN_SECURITY_REVIEW_DAILY_USD: "-3" })).toBe(50_000);
    expect(dailyBudgetCentiCredits({ OPENLEN_SECURITY_REVIEW_DAILY_USD: " " })).toBe(50_000);
  });
});
