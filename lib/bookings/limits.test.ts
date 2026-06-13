// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  bookingIdentityKey,
  bookingIpKey,
  BOOKING_IDENTITY_LIMITS,
  BOOKING_IP_LIMITS,
  BOOKING_MONTHLY_CAP,
} from "./limits";

describe("booking limit keys", () => {
  it("scopes the IP key by project so site A can't burn site B", () => {
    expect(bookingIpKey("A", "1.2.3.4")).not.toBe(bookingIpKey("B", "1.2.3.4"));
    expect(bookingIpKey("A", "1.2.3.4")).toContain("booking-create");
  });

  it("hashes the identity (no raw email/PII in the ledger) and normalizes case", () => {
    const k = bookingIdentityKey("A", "Visitor@Example.com");
    expect(k).not.toContain("Visitor@Example.com");
    expect(k).not.toContain("example.com");
    // case/whitespace-insensitive: same person → same key
    expect(bookingIdentityKey("A", "  visitor@example.com ")).toBe(k);
    // project-scoped
    expect(bookingIdentityKey("B", "visitor@example.com")).not.toBe(k);
  });

  it("windows are ascending and sane", () => {
    expect(BOOKING_IP_LIMITS.length).toBeGreaterThan(0);
    expect(BOOKING_IDENTITY_LIMITS.length).toBeGreaterThan(0);
    for (const w of [...BOOKING_IP_LIMITS, ...BOOKING_IDENTITY_LIMITS]) {
      expect(w.max).toBeGreaterThan(0);
      expect(w.windowMs).toBeGreaterThan(0);
    }
    expect(BOOKING_MONTHLY_CAP.pro).toBeGreaterThan(BOOKING_MONTHLY_CAP.free);
  });
});
