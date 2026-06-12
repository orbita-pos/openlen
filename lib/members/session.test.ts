// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MEMBER_COOKIE,
  buildMemberCookie,
  clearMemberCookie,
  generateSessionToken,
  hashSessionToken,
  readMemberCookie,
} from "./session";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("opaque session tokens", () => {
  it("are 256-bit, URL-safe, and hash deterministically", () => {
    const { raw, hash } = generateSessionToken();
    expect(raw.length).toBeGreaterThanOrEqual(42); // 32 bytes base64url
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(raw)).toBe(hash);
  });

  it("never repeat and never collide on hash", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const { raw, hash } = generateSessionToken();
      expect(seen.has(raw)).toBe(false);
      seen.add(raw);
      seen.add(hash);
    }
  });

  it("the raw token is unrecoverable from the stored hash", () => {
    const { raw, hash } = generateSessionToken();
    expect(hash).not.toContain(raw.slice(0, 8));
    expect(hashSessionToken("guess")).not.toBe(hash);
  });
});

describe("member cookie", () => {
  it("is host-only, httpOnly, lax", () => {
    const cookie = buildMemberCookie("tok");
    expect(cookie).toContain(`${MEMBER_COOKIE}=tok`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Domain"); // host-only IS the isolation
  });

  it("adds Secure only in production", () => {
    expect(buildMemberCookie("tok")).not.toContain("Secure");
    vi.stubEnv("NODE_ENV", "production");
    expect(buildMemberCookie("tok")).toContain("; Secure");
    expect(clearMemberCookie()).toContain("Max-Age=0");
  });

  it("parses the cookie header", () => {
    const req = (cookie: string | null) =>
      new Request("https://x.test/", {
        headers: cookie === null ? {} : { cookie },
      });
    expect(readMemberCookie(req(null))).toBeNull();
    expect(readMemberCookie(req("other=1"))).toBeNull();
    expect(readMemberCookie(req(`${MEMBER_COOKIE}=abc`))).toBe("abc");
    expect(
      readMemberCookie(req(`a=1; ${MEMBER_COOKIE}=abc ; b=2`)),
    ).toBe("abc");
    expect(readMemberCookie(req(`${MEMBER_COOKIE}=`))).toBeNull();
  });
});
