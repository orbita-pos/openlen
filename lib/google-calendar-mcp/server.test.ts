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
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith("https://oauth2.googleapis.com/tokeninfo")) {
        const token = new URL(url).searchParams.get("access_token");
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
