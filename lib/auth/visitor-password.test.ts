import { describe, it, expect } from "vitest";
import {
  DUMMY_HASH,
  hashPassword,
  isValidPassword,
  verifyPassword,
} from "@/lib/auth/visitor-password";

describe("visitor-password", () => {
  it("hashes and verifies a password", async () => {
    const hash = await hashPassword("hunter22");
    expect(hash).not.toEqual("hunter22");
    expect(await verifyPassword("hunter22", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("DUMMY_HASH is a valid bcrypt hash that never matches a real password", async () => {
    expect(await verifyPassword("anything", DUMMY_HASH)).toBe(false);
  });

  it("isValidPassword enforces 8..200 chars and string type", () => {
    expect(isValidPassword("1234567")).toBe(false);
    expect(isValidPassword("12345678")).toBe(true);
    expect(isValidPassword("x".repeat(200))).toBe(true);
    expect(isValidPassword("x".repeat(201))).toBe(false);
    expect(isValidPassword(123)).toBe(false);
  });
});
