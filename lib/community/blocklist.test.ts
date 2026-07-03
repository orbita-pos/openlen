import { describe, it, expect } from "vitest";
import { containsBlockedTerm } from "./blocklist";

describe("containsBlockedTerm", () => {
  it("returns null for clean copy", () => {
    expect(containsBlockedTerm("A cozy bakery landing page")).toBeNull();
  });
  it("matches case-insensitively on whole words", () => {
    expect(containsBlockedTerm("Best CASINO bonuses")).toBe("casino");
  });
  it("does not match a term embedded inside another word", () => {
    // 'cialis' is blocked, but 'specialist' must not trip it.
    expect(containsBlockedTerm("Our specialist team")).toBeNull();
  });
});
