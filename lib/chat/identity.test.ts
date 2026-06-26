import { describe, expect, it } from "vitest";
import {
  deriveOwnerUsername,
  hashPassword,
  isValidPassword,
  isValidUsername,
  normalizeUsername,
  sanitizeDisplayName,
  verifyPassword,
} from "@/lib/chat/identity";

describe("chat identity", () => {
  it("normalizes usernames (drops @, lowercases, trims)", () => {
    expect(normalizeUsername("  @Juan  ")).toBe("juan");
    expect(normalizeUsername("MARIA_99")).toBe("maria_99");
  });

  it("validates username shape", () => {
    expect(isValidUsername("juan")).toBe(true);
    expect(isValidUsername("a_b_2")).toBe(true);
    expect(isValidUsername("9lives")).toBe(false); // must start with a letter
    expect(isValidUsername("ab")).toBe(false); // too short
    expect(isValidUsername("hey there")).toBe(false); // space
    expect(isValidUsername("x".repeat(21))).toBe(false); // too long
  });

  it("validates password length", () => {
    expect(isValidPassword("hunter22")).toBe(true);
    expect(isValidPassword("short")).toBe(false);
  });

  it("hashes and verifies a password", async () => {
    const hash = await hashPassword("hunter22");
    expect(hash).not.toBe("hunter22");
    expect(await verifyPassword("hunter22", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("sanitizes display names", () => {
    expect(sanitizeDisplayName("  Juan   Pérez ")).toBe("Juan Pérez");
    expect(sanitizeDisplayName("   ")).toBeNull();
    expect(sanitizeDisplayName("x".repeat(60))!.length).toBe(40);
  });
});

describe("deriveOwnerUsername", () => {
  it("normalizes a title into a valid username", () => {
    expect(deriveOwnerUsername("Café Luna")).toMatch(/^[a-z][a-z0-9_]{2,19}$/);
    expect(deriveOwnerUsername("Café Luna")).toBe("caf_luna");
  });
  it("falls back to 'owner' for unusable titles", () => {
    expect(deriveOwnerUsername("")).toBe("owner");
    expect(deriveOwnerUsername("123")).toBe("owner");       // can't start with a digit
    expect(deriveOwnerUsername("!!")).toBe("owner");
  });
  it("caps at 20 chars and trims trailing underscores", () => {
    expect(deriveOwnerUsername("A very long business name here").length).toBeLessThanOrEqual(20);
    expect(deriveOwnerUsername("Hello!!!").endsWith("_")).toBe(false);
  });
});
