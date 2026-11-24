// lib/google-calendar-mcp/token.test.ts
// @vitest-environment node
//
// The server takes only Google tokens issued to OpenLen's own client, unexpired, with the three scopes (spec local
// 2026-11-24-servidor-de-google-calendar, §5.2).
import { beforeEach, describe, expect, it } from "vitest";
import { checkGoogleToken, forgetGoogleToken, resetTokenCache, type TokenDeps } from "./token";

const CLIENT = "openlen-client.apps.googleusercontent.com";
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
];
const NOW_S = 1_800_000_000;

function deps(answer: (token: string) => Response, calls: string[] = [], now = () => NOW_S * 1000): TokenDeps {
  return {
    clientId: CLIENT,
    now,
    fetch: (async (input: RequestInfo | URL) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      expect(url.origin + url.pathname).toBe("https://oauth2.googleapis.com/tokeninfo");
      const token = url.searchParams.get("access_token") ?? "";
      calls.push(token);
      return answer(token);
    }) as typeof fetch,
  };
}

const good = (over: Record<string, string> = {}) =>
  new Response(JSON.stringify({ aud: CLIENT, azp: CLIENT, scope: SCOPES.join(" "), exp: String(NOW_S + 3600), expires_in: "3600", ...over }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

beforeEach(() => resetTokenCache());

describe("checkGoogleToken", () => {
  it("no token → 401", async () => {
    expect(await checkGoogleToken(undefined, deps(() => good()))).toEqual({ ok: false, status: 401 });
  });

  it("tokeninfo says 400 → 401", async () => {
    const r = await checkGoogleToken("ya29.bad", deps(() => new Response(JSON.stringify({ error_description: "Invalid Value" }), { status: 400 })));
    expect(r).toEqual({ ok: false, status: 401 });
  });

  it("a token of another app (aud and azp) → 401", async () => {
    const r = await checkGoogleToken("ya29.other", deps(() => good({ aud: "someone-else", azp: "someone-else" })));
    expect(r).toEqual({ ok: false, status: 401 });
  });

  it("an expired token → 401", async () => {
    const r = await checkGoogleToken("ya29.old", deps(() => good({ exp: String(NOW_S - 1), expires_in: "0" })));
    expect(r).toEqual({ ok: false, status: 401 });
  });

  it("missing calendar.events.freebusy → 403 naming it", async () => {
    const r = await checkGoogleToken("ya29.narrow", deps(() => good({ scope: SCOPES.slice(0, 2).join(" ") })));
    expect(r).toEqual({ ok: false, status: 403, missing: ["https://www.googleapis.com/auth/calendar.events.freebusy"] });
  });

  it("a good token → ok with its scopes and expiry, and the second time tokeninfo isn't asked", async () => {
    const calls: string[] = [];
    const d = deps(() => good(), calls);
    const r = await checkGoogleToken("ya29.good", d);
    expect(r).toEqual({ ok: true, authInfo: { token: "ya29.good", clientId: CLIENT, scopes: SCOPES, expiresAt: NOW_S + 3600 } });
    await checkGoogleToken("ya29.good", d);
    expect(calls).toEqual(["ya29.good"]);
  });

  it("only azp matching is enough (Google sets aud to the client that asked)", async () => {
    const r = await checkGoogleToken("ya29.azp", deps(() => good({ aud: "something-else" })));
    expect(r.ok).toBe(true);
  });

  // Review Focus 3: the cache never outlives the token.
  it("🔴 the cache doesn't outlive the token: after it expires tokeninfo is asked again, and says 401", async () => {
    const calls: string[] = [];
    let nowMs = NOW_S * 1000;
    let expired = false;
    const d = deps(() => (expired ? new Response("{}", { status: 400 }) : good()), calls, () => nowMs);
    expect((await checkGoogleToken("ya29.short", d)).ok).toBe(true);
    nowMs = (NOW_S + 3601) * 1000;
    expired = true;
    expect(await checkGoogleToken("ya29.short", d)).toEqual({ ok: false, status: 401 });
    expect(calls).toEqual(["ya29.short", "ya29.short"]);
  });

  // Final review, I2: tokeninfo not answering says nothing about the token. A 401 would send the connector to refresh, get
  // 401 again and park every person in needs-auth (never retried on its own); a 503 is a failure it retries. Still closed.
  it("🔴 a network failure is a 503, not a sign-in, and the token never shows in what is thrown or logged", async () => {
    const d = deps(() => {
      throw new Error("network down");
    });
    const r = await checkGoogleToken("ya29.SECRET_VALUE", d);
    expect(r).toEqual({ ok: false, status: 503 });
    expect(JSON.stringify(r)).not.toContain("SECRET_VALUE");
  });

  it("🔴 tokeninfo answering 5xx or 429 is a 503; only its verdict on the token (400) is a 401", async () => {
    expect(await checkGoogleToken("ya29.a", deps(() => new Response("oops", { status: 500 })))).toEqual({ ok: false, status: 503 });
    expect(await checkGoogleToken("ya29.b", deps(() => new Response("slow down", { status: 429 })))).toEqual({ ok: false, status: 503 });
    expect(await checkGoogleToken("ya29.c", deps(() => new Response('{"error":"invalid_token"}', { status: 400 })))).toEqual({ ok: false, status: 401 });
  });

  // Final review, I1: a token Google stopped taking mid-call is forgotten, so the next request asks tokeninfo again.
  it("forgetGoogleToken makes the next check ask tokeninfo again", async () => {
    const calls: string[] = [];
    let alive = true;
    const d = deps(() => (alive ? good() : new Response('{"error":"invalid_token"}', { status: 400 })), calls);
    expect((await checkGoogleToken("ya29.revoked", d)).ok).toBe(true);
    alive = false;
    expect((await checkGoogleToken("ya29.revoked", d)).ok).toBe(true);
    forgetGoogleToken("ya29.revoked");
    expect(await checkGoogleToken("ya29.revoked", d)).toEqual({ ok: false, status: 401 });
    expect(calls).toEqual(["ya29.revoked", "ya29.revoked"]);
  });
});
