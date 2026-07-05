import { describe, it, expect } from "vitest";
import { shouldClearPassword } from "@/lib/members/verification";

describe("shouldClearPassword (anti-squatting reclaim rule)", () => {
  const cases: Array<[boolean, boolean, boolean]> = [
    [true, false, true],   // unverified row WITH a password → reclaim
    [true, true, false],   // already verified → trusted, keep
    [false, false, false], // no password → nothing to clear
    [false, true, false],  // no password + verified → nothing
  ];
  it.each(cases)(
    "hasPassword=%s alreadyVerified=%s → %s",
    (hasPassword, alreadyVerified, expected) => {
      expect(shouldClearPassword({ hasPassword, alreadyVerified })).toBe(expected);
    },
  );
});
