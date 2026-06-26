import { beforeAll, describe, expect, it } from "vitest";
import {
  generatePreviewToken,
  hashPasscode,
  isPreviewExpired,
  previewTokenMatches,
  previewUnlockToken,
  verifyPasscode,
  verifyUnlockToken,
} from "./preview";

describe("preview tokens", () => {
  it("generates a url-safe token of at least 43 chars (256-bit base64url)", () => {
    const t = generatePreviewToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t.length).toBeGreaterThanOrEqual(43);
  });

  it("generates a fresh token each call", () => {
    expect(generatePreviewToken()).not.toBe(generatePreviewToken());
  });

  it("matches a token against itself", () => {
    const t = generatePreviewToken();
    expect(previewTokenMatches(t, t)).toBe(true);
  });

  it("rejects a different token", () => {
    expect(
      previewTokenMatches(generatePreviewToken(), generatePreviewToken()),
    ).toBe(false);
  });

  it("rejects empty / null / undefined on either side without throwing", () => {
    const t = generatePreviewToken();
    expect(previewTokenMatches(t, "")).toBe(false);
    expect(previewTokenMatches("", t)).toBe(false);
    expect(previewTokenMatches(t, null)).toBe(false);
    expect(previewTokenMatches(null, t)).toBe(false);
    expect(previewTokenMatches(undefined, undefined)).toBe(false);
  });

  it("rejects a length-mismatched candidate (no length-leak path throws)", () => {
    expect(previewTokenMatches("short", generatePreviewToken())).toBe(false);
  });

  it("rejects a truncated prefix of a valid token", () => {
    const t = generatePreviewToken();
    expect(previewTokenMatches(t, t.slice(0, -1))).toBe(false);
  });
});

describe("preview passcode", () => {
  beforeAll(() => {
    process.env.NEXTAUTH_SECRET = "test-secret-for-preview-passcodes";
  });

  it("hashes deterministically and url-safe", () => {
    const h = hashPasscode("proj1", "hunter2");
    expect(h).toBe(hashPasscode("proj1", "hunter2"));
    expect(h).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("is per-project — same passcode differs across projects", () => {
    expect(hashPasscode("proj1", "hunter2")).not.toBe(hashPasscode("proj2", "hunter2"));
  });

  it("verifies the right passcode and rejects the wrong one / project / empty", () => {
    const h = hashPasscode("proj1", "hunter2");
    expect(verifyPasscode("proj1", "hunter2", h)).toBe(true);
    expect(verifyPasscode("proj1", "wrong", h)).toBe(false);
    expect(verifyPasscode("proj2", "hunter2", h)).toBe(false);
    expect(verifyPasscode("proj1", "", h)).toBe(false);
    expect(verifyPasscode("proj1", "hunter2", null)).toBe(false);
  });
});

describe("preview unlock cookie", () => {
  beforeAll(() => {
    process.env.NEXTAUTH_SECRET = "test-secret-for-preview-passcodes";
  });

  it("round-trips for the matching (project, passcodeHash)", () => {
    const hash = hashPasscode("proj1", "pw");
    const cookie = previewUnlockToken("proj1", hash);
    expect(verifyUnlockToken("proj1", hash, cookie)).toBe(true);
  });

  it("is invalidated when the passcode (hash) changes", () => {
    const hashA = hashPasscode("proj1", "old");
    const cookie = previewUnlockToken("proj1", hashA);
    const hashB = hashPasscode("proj1", "new");
    expect(verifyUnlockToken("proj1", hashB, cookie)).toBe(false);
  });

  it("rejects empty / cross-project cookies", () => {
    const hash = hashPasscode("proj1", "pw");
    const cookie = previewUnlockToken("proj1", hash);
    expect(verifyUnlockToken("proj1", hash, "")).toBe(false);
    expect(verifyUnlockToken("proj2", hash, cookie)).toBe(false);
  });
});

describe("preview expiry", () => {
  const NOW = Date.parse("2026-06-25T12:00:00.000Z");

  it("absent / empty never expires", () => {
    expect(isPreviewExpired(undefined, NOW)).toBe(false);
    expect(isPreviewExpired(null, NOW)).toBe(false);
    expect(isPreviewExpired("", NOW)).toBe(false);
  });

  it("future is not expired, past is expired", () => {
    expect(isPreviewExpired("2026-06-26T12:00:00.000Z", NOW)).toBe(false);
    expect(isPreviewExpired("2026-06-24T12:00:00.000Z", NOW)).toBe(true);
  });

  it("a malformed timestamp fails closed (expired)", () => {
    expect(isPreviewExpired("not-a-date", NOW)).toBe(true);
  });
});
