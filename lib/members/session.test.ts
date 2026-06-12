// @vitest-environment node

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  MEMBER_COOKIE,
  buildMemberCookie,
  clearMemberCookie,
  readMemberCookie,
  signMemberSession,
  verifyMemberSession,
} from "./session";

const CLAIMS = { memberId: "mem-123", projectId: "proj-456" };

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-for-member-sessions";
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("member session JWT", () => {
  it("round-trips claims", async () => {
    const token = await signMemberSession(CLAIMS);
    expect(token.split(".")).toHaveLength(3);
    expect(await verifyMemberSession(token)).toEqual(CLAIMS);
  });

  it("rejects a tampered token", async () => {
    const token = await signMemberSession(CLAIMS);
    const [h, p, s] = token.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({ mid: "attacker", pid: CLAIMS.projectId }),
    ).toString("base64url");
    expect(await verifyMemberSession(`${h}.${forgedPayload}.${s}`)).toBeNull();
    expect(await verifyMemberSession(`${h}.${p}.AAAA${s.slice(4)}`)).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signMemberSession(CLAIMS);
    vi.stubEnv("NEXTAUTH_SECRET", "a-rotated-secret");
    expect(await verifyMemberSession(token)).toBeNull();
  });

  it("rejects garbage and empty strings", async () => {
    expect(await verifyMemberSession("")).toBeNull();
    expect(await verifyMemberSession("not-a-jwt")).toBeNull();
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
