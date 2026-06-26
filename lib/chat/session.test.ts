import { describe, expect, it } from "vitest";
import {
  CHAT_COOKIE,
  buildChatCookie,
  clearChatCookie,
  generateSessionToken,
  hashSessionToken,
  readChatCookie,
} from "@/lib/chat/session";

describe("chat session", () => {
  it("hashes the raw token deterministically (sha256 hex)", () => {
    const { raw, hash } = generateSessionToken();
    expect(raw).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashSessionToken(raw)).toBe(hash);
  });

  it("builds a host-only HttpOnly Lax cookie and clears it", () => {
    const c = buildChatCookie("tok123");
    expect(c).toContain(`${CHAT_COOKIE}=tok123`);
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Lax");
    expect(c).not.toMatch(/Domain=/i);
    expect(clearChatCookie()).toContain("Max-Age=0");
  });

  it("reads exactly the chat cookie out of a Cookie header", () => {
    const req = new Request("https://x.test", {
      headers: { cookie: `other=1; ${CHAT_COOKIE}=abc; ol_member=zzz` },
    });
    expect(readChatCookie(req)).toBe("abc");
    expect(readChatCookie(new Request("https://x.test"))).toBeNull();
  });
});
