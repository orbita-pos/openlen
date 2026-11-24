// lib/google-calendar-mcp/server.test.ts
// @vitest-environment node
//
// The Calendar server over HTTP (spec local 2026-11-24-servidor-de-google-calendar, §5.1, §5.2, §5.7): an official MCP
// client lists the nine tools; no token is a 401 pointing at the metadata, a missing scope a 403, the 61st call in a
// minute a 429, and OPENLEN_GCAL_MCP=0 a 503.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { connectTestClient } from "@/lib/mcp/testing";
import { buildGcalMcpHandler } from "./server";
import { resetTokenCache, type TokenDeps } from "./token";

const CLIENT = "openlen-client";
const ALL = "https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.events.freebusy";

function deps(scope = ALL): TokenDeps {
  return {
    clientId: CLIENT,
    now: () => 1_800_000_000_000,
    sleep: async () => {},
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith("https://oauth2.googleapis.com/tokeninfo")) {
        const token = /^Bearer (.+)$/.exec(new Headers(init?.headers).get("authorization") ?? "")?.[1] ?? null;
        if (!token?.startsWith("ya29.")) return new Response("{}", { status: 400 });
        return new Response(JSON.stringify({ azp: CLIENT, aud: CLIENT, scope, exp: "1800003600" }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  };
}

const rpc = (headers: Record<string, string> = {}) =>
  new Request("http://mcp.test/google-calendar", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });

beforeEach(() => {
  resetTokenCache();
  vi.stubEnv("GCAL_MCP_RESOURCE_URL", "");
  vi.stubEnv("OPENLEN_GCAL_MCP", "");
  vi.stubEnv("OPENLEN_MCP", "");
});

describe("the Calendar server over HTTP", () => {
  it("an official client connects and lists the nine tools", async () => {
    const client = await connectTestClient(buildGcalMcpHandler(deps()), "ya29.good");
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(9);
    await client.close();
  });

  it("no token: 401 with the absolute link to the metadata", async () => {
    const res = await buildGcalMcpHandler(deps())(rpc());
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain('resource_metadata="https://mcp.openlen.com/.well-known/oauth-protected-resource/google-calendar"');
  });

  it("a token tokeninfo rejects: 401", async () => {
    expect((await buildGcalMcpHandler(deps())(rpc({ authorization: "Bearer nope" }))).status).toBe(401);
  });

  it("a token without freebusy: 403 insufficient_scope naming it", async () => {
    const narrow = ALL.split(" ").slice(0, 2).join(" ");
    const res = await buildGcalMcpHandler(deps(narrow))(rpc({ authorization: "Bearer ya29.narrow" }));
    expect(res.status).toBe(403);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain('error="insufficient_scope"');
    expect(challenge).toContain("https://www.googleapis.com/auth/calendar.events.freebusy");
  });

  it("the 61st call in a minute with the same token: 429", async () => {
    const h = buildGcalMcpHandler(deps());
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await h(rpc({ authorization: "Bearer ya29.busy" }))).status;
    expect(last).toBe(429);
  });

  it("OPENLEN_GCAL_MCP=0: 503", async () => {
    vi.stubEnv("OPENLEN_GCAL_MCP", "0");
    expect((await buildGcalMcpHandler(deps())(rpc({ authorization: "Bearer ya29.good" }))).status).toBe(503);
  });
});

// Final review: the wire from the request's token to Google, and what the server answers when Google can't vouch for it.
describe("a call through the server", () => {
  /** tokeninfo knows ya29.* tokens while `alive`; the Calendar API records the bearer it got and answers `calendar`. */
  function google(o: { alive?: () => boolean; tokeninfo?: () => Response; calendar?: () => Response } = {}) {
    const bearers: string[] = [];
    const d: TokenDeps = {
      clientId: CLIENT,
      now: () => 1_800_000_000_000,
      sleep: async () => {},
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.startsWith("https://oauth2.googleapis.com/tokeninfo")) {
          if (o.tokeninfo) return o.tokeninfo();
          const token = /^Bearer (.+)$/.exec(new Headers(init?.headers).get("authorization") ?? "")?.[1] ?? null;
          if (!token?.startsWith("ya29.") || (o.alive && !o.alive())) return new Response('{"error":"invalid_token"}', { status: 400 });
          return new Response(JSON.stringify({ azp: CLIENT, aud: CLIENT, scope: ALL, exp: "1800003600" }), { status: 200 });
        }
        if (url.startsWith("https://www.googleapis.com/calendar/v3/")) {
          bearers.push(new Headers(init?.headers).get("authorization") ?? "");
          return o.calendar?.() ?? new Response(JSON.stringify({ items: [{ id: "yo@x.com", summary: "Yo", timeZone: "Europe/Madrid", primary: true, accessRole: "owner" }] }), { status: 200 });
        }
        return new Response("{}", { status: 404 });
      }) as typeof fetch,
    };
    return { d, bearers };
  }

  it("🔴 tools/call reaches Google with the person's own token, and Len reads Google's answer", async () => {
    const { d, bearers } = google();
    const client = await connectTestClient(buildGcalMcpHandler(d), "ya29.person");
    const r = (await client.callTool({ name: "list_calendars", arguments: {} })) as { content: { text?: string }[]; isError?: boolean };
    await client.close();
    expect(r.isError).toBeFalsy();
    expect(bearers).toEqual(["Bearer ya29.person"]);
    expect(JSON.parse(r.content[0]!.text!)).toEqual({ calendars: [{ id: "yo@x.com", summary: "Yo", timeZone: "Europe/Madrid", primary: true, accessRole: "owner" }] });
  });

  it("🔴 tokeninfo down or failing: 503, never a 401 that would send everyone to sign in again", async () => {
    const down = google({
      tokeninfo: () => {
        throw new Error("network down");
      },
    });
    expect((await buildGcalMcpHandler(down.d)(rpc({ authorization: "Bearer ya29.x" }))).status).toBe(503);
    const failing = google({ tokeninfo: () => new Response("oops", { status: 502 }) });
    expect((await buildGcalMcpHandler(failing.d)(rpc({ authorization: "Bearer ya29.y" }))).status).toBe(503);
  });

  // As an MCP client like Claude Code's expects it: the call Google refused IS the 401, with the challenge, so the client
  // refreshes and retries that same call (or asks the person to sign in again) — not one failed call first.
  it("🔴 Google refusing the token in a call: that call answers 401 with the challenge", async () => {
    const { d } = google({ calendar: () => new Response(JSON.stringify({ error: { code: 401, message: "Invalid Credentials" } }), { status: 401 }) });
    const h = buildGcalMcpHandler(d);
    const answers: { method: string; status: number; challenge: string | null }[] = [];
    const recording = async (req: Request) => {
      const body = req.method === "POST" ? ((await req.clone().json()) as { method?: string }) : {};
      const res = await h(req);
      answers.push({ method: body.method ?? req.method, status: res.status, challenge: res.headers.get("www-authenticate") });
      return res;
    };
    const client = await connectTestClient(recording, "ya29.revoked");
    await expect(client.callTool({ name: "list_calendars", arguments: {} })).rejects.toThrow();
    await client.close().catch(() => {});
    const call = answers.find((a) => a.method === "tools/call")!;
    expect(call.status).toBe(401);
    expect(call.challenge).toContain('error="invalid_token"');
    expect(call.challenge).toContain('resource_metadata="https://mcp.openlen.com/.well-known/oauth-protected-resource/google-calendar"');
  });

  it("🔴 Google refusing the token in a call: the token is forgotten too, so the next request asks Google again", async () => {
    let alive = true;
    const { d } = google({
      alive: () => alive,
      calendar: () => new Response(JSON.stringify({ error: { code: 401, message: "Invalid Credentials" } }), { status: 401 }),
    });
    const h = buildGcalMcpHandler(d);
    const client = await connectTestClient(h, "ya29.revoked");
    await expect(client.callTool({ name: "list_calendars", arguments: {} })).rejects.toThrow();
    await client.close().catch(() => {});
    alive = false;
    expect((await h(rpc({ authorization: "Bearer ya29.revoked" }))).status).toBe(401);
  });
});
