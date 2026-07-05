import { describe, it, expect } from "vitest";
import { shouldClearPassword } from "@/lib/members/verification";

describe("shouldClearPassword (anti-okupa reclaim rule)", () => {
  it("clears ONLY a login-token click on an unverified row that has a password", () => {
    expect(shouldClearPassword({ tokenKind: "login", hasPassword: true, alreadyVerified: false })).toBe(true);
  });
  it("keeps the password on a confirm token (self-confirmation)", () => {
    expect(shouldClearPassword({ tokenKind: "confirm", hasPassword: true, alreadyVerified: false })).toBe(false);
  });
  it("keeps the password if the row was already verified", () => {
    expect(shouldClearPassword({ tokenKind: "login", hasPassword: true, alreadyVerified: true })).toBe(false);
  });
  it("nothing to clear when there is no password", () => {
    expect(shouldClearPassword({ tokenKind: "login", hasPassword: false, alreadyVerified: false })).toBe(false);
  });
});
