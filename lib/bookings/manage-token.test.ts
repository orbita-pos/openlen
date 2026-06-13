// @vitest-environment node

import { beforeAll, describe, expect, it } from "vitest";
import { manageToken, verifyManageToken, manageUrl } from "./manage-token";

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || "test-secret-for-bookings";
});

describe("booking manage tokens", () => {
  it("round-trips: a freshly minted token verifies", () => {
    const t = manageToken("proj1", "bk1");
    expect(verifyManageToken("proj1", "bk1", t)).toBe(true);
  });

  it("is stable (deterministic HMAC, not random)", () => {
    expect(manageToken("proj1", "bk1")).toBe(manageToken("proj1", "bk1"));
  });

  it("does not cross projects or bookings", () => {
    const t = manageToken("proj1", "bk1");
    expect(verifyManageToken("proj2", "bk1", t)).toBe(false);
    expect(verifyManageToken("proj1", "bk2", t)).toBe(false);
  });

  it("rejects empty / garbage tokens without throwing", () => {
    expect(verifyManageToken("proj1", "bk1", "")).toBe(false);
    expect(verifyManageToken("proj1", "bk1", "not-a-real-token")).toBe(false);
  });

  it("builds a same-host manage URL on /api/bk/<sub>/", () => {
    const url = manageUrl({
      baseUrl: "https://acme.openlen.com",
      sub: "acme",
      projectId: "proj1",
      bookingId: "bk 1/&",
    });
    expect(url).toContain("https://acme.openlen.com/api/bk/acme/manage?");
    expect(url).toContain("b=bk%201%2F%26"); // encoded
    expect(url).toContain("&t=");
  });
});
