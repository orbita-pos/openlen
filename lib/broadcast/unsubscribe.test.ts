// @vitest-environment node

import { beforeAll, describe, expect, it, vi, afterEach } from "vitest";
import {
  unsubscribeToken,
  unsubscribeUrl,
  verifyUnsubscribe,
} from "./unsubscribe";

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-for-unsub";
});
afterEach(() => vi.unstubAllEnvs());

describe("unsubscribe token", () => {
  it("round-trips for the right (project, member)", () => {
    const t = unsubscribeToken("p1", "m1");
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
    expect(verifyUnsubscribe("p1", "m1", t)).toBe(true);
  });

  it("is bound to BOTH project and member", () => {
    const t = unsubscribeToken("p1", "m1");
    expect(verifyUnsubscribe("p2", "m1", t)).toBe(false);
    expect(verifyUnsubscribe("p1", "m2", t)).toBe(false);
  });

  it("rejects tampered / empty / malformed tokens", () => {
    const t = unsubscribeToken("p1", "m1");
    expect(verifyUnsubscribe("p1", "m1", "")).toBe(false);
    expect(verifyUnsubscribe("p1", "m1", t + "x")).toBe(false);
    expect(verifyUnsubscribe("p1", "m1", t.slice(0, -1))).toBe(false);
    expect(verifyUnsubscribe("p1", "m1", "AAAA" + t.slice(4))).toBe(false);
  });

  it("changes with the signing secret (rotation invalidates links)", () => {
    const t = unsubscribeToken("p1", "m1");
    vi.stubEnv("NEXTAUTH_SECRET", "a-rotated-secret");
    expect(verifyUnsubscribe("p1", "m1", t)).toBe(false);
  });

  it("bakes a usable site-host URL", () => {
    const url = unsubscribeUrl({
      baseUrl: "https://mysite.openlen.com",
      sub: "mysite",
      projectId: "p1",
      memberId: "m1",
    });
    expect(url).toContain("https://mysite.openlen.com/api/b/mysite/unsubscribe?m=m1&t=");
    const t = new URL(url).searchParams.get("t")!;
    expect(verifyUnsubscribe("p1", "m1", t)).toBe(true);
  });
});
