// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  MEMBER_CAPS,
  MEMBER_LOGIN_EMAIL_LIMITS,
  MEMBER_LOGIN_IP_LIMITS,
  emailLimitKey,
  memberEmailCapWindows,
  siteEmailCapKey,
} from "./limits";

describe("member limit keys", () => {
  it("hashes the email — no raw PII in rateLimitEvents", () => {
    const key = emailLimitKey("Visitor@Example.com");
    expect(key).not.toContain("@");
    expect(key).toMatch(/^email:[0-9a-f]{16}:member-login$/);
  });

  it("normalizes case and whitespace into the same key", () => {
    expect(emailLimitKey("  A@B.CO ")).toBe(emailLimitKey("a@b.co"));
    expect(emailLimitKey("a@b.co")).not.toBe(emailLimitKey("c@d.co"));
  });

  it("scopes the site cap by projectId", () => {
    expect(siteEmailCapKey("p1")).toBe("site:p1:member-email");
  });
});

describe("member caps", () => {
  it("pro outclasses free on both axes", () => {
    expect(MEMBER_CAPS.pro.members).toBeGreaterThan(MEMBER_CAPS.free.members);
    expect(MEMBER_CAPS.pro.monthlyEmails).toBeGreaterThan(
      MEMBER_CAPS.free.monthlyEmails,
    );
  });

  it("cap windows reflect the plan", () => {
    const free = memberEmailCapWindows("free");
    const pro = memberEmailCapWindows("pro");
    expect(free[0].max).toBe(MEMBER_CAPS.free.monthlyEmails);
    expect(pro[0].max).toBe(MEMBER_CAPS.pro.monthlyEmails);
    expect(free[0].windowMs).toBe(30 * 24 * 60 * 60 * 1000);
    expect(free[0].label).toBe("monthly");
  });

  it("burst guards are sane", () => {
    expect(MEMBER_LOGIN_IP_LIMITS[0].max).toBeGreaterThan(0);
    expect(MEMBER_LOGIN_EMAIL_LIMITS[0].max).toBeLessThan(
      MEMBER_LOGIN_IP_LIMITS[0].max,
    );
  });
});
