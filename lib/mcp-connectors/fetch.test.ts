// @vitest-environment node
//
// The fetch Len's MCP connectors use (spec local 2026-11-06-conectores-mcp, §5.4): https only, no redirects, a public
// IPv4 resolved once and pinned, the allowlist of local origins never honoured, the answer read through a byte cap.
// DNS and the network are injected.
import { afterEach, describe, expect, it } from "vitest";

import { allowEgressOrigin } from "@/lib/security/egress-proxy";

import { createGuardedFetch, McpEgressError, type PinnedRequest } from "./fetch";

const dns = (map: Record<string, string>) => async (host: string) => {
  const a = map[host];
  if (!a) throw new Error("ENOTFOUND");
  return [{ address: a, family: 4 }];
};

const sent: PinnedRequest[] = [];
const answer = (status: number, body = "ok", headers: Record<string, string> = {}) => async (r: PinnedRequest) => {
  sent.push(r);
  return new Response(body, { status, headers });
};
afterEach(() => {
  sent.length = 0;
});

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof McpEgressError) return e.code;
    throw e;
  }
  return "passed";
};

describe("createGuardedFetch", () => {
  it("refuses http:", async () => {
    const f = createGuardedFetch({ maxBytes: 1000, lookup: dns({}), send: answer(200) });
    expect(await codeOf(f("http://example.com/mcp"))).toBe("scheme");
    expect(sent).toEqual([]);
  });

  it("refuses private and internal places, by literal or by name", async () => {
    const f = createGuardedFetch({ maxBytes: 1000, lookup: dns({ "evil.example.com": "192.168.1.2" }), send: answer(200) });
    for (const u of ["https://127.0.0.1/mcp", "https://10.0.0.1/mcp", "https://evil.example.com/mcp", "https://localhost/mcp", "https://metadata.google.internal/x"]) {
      expect(await codeOf(f(u)), u).toBe("blocked");
    }
    expect(sent).toEqual([]);
  });

  it("refuses even while allowEgressOrigin registered the same host:port", async () => {
    const release = allowEgressOrigin("127.0.0.1:4555");
    try {
      const f = createGuardedFetch({ maxBytes: 1000, lookup: dns({}), send: answer(200) });
      expect(await codeOf(f("https://127.0.0.1:4555/mcp"))).toBe("blocked");
    } finally {
      release();
    }
  });

  it("a 302 is an error, never followed", async () => {
    const f = createGuardedFetch({ maxBytes: 1000, lookup: dns({ "mcp.example.com": "93.184.216.34" }), send: answer(302, "", { location: "https://127.0.0.1/" }) });
    expect(await codeOf(f("https://mcp.example.com/mcp"))).toBe("redirect");
    expect(sent).toHaveLength(1);
  });

  it("a body over maxBytes throws too_large while it is read", async () => {
    const f = createGuardedFetch({ maxBytes: 10, lookup: dns({ "mcp.example.com": "93.184.216.34" }), send: answer(200, "x".repeat(50)) });
    const res = await f("https://mcp.example.com/mcp");
    expect(await codeOf(res.text())).toBe("too_large");
  });

  it("a public host passes, pinned to the IP it resolved, with its own host name", async () => {
    const f = createGuardedFetch({ maxBytes: 1000, lookup: dns({ "mcp.example.com": "93.184.216.34" }), send: answer(200, "hello") });
    const res = await f("https://mcp.example.com/mcp?x=1", { method: "POST", headers: { authorization: "Bearer t" }, body: "{}" });
    expect(await res.text()).toBe("hello");
    expect(sent[0]!.url.href).toBe("https://mcp.example.com/mcp?x=1");
    expect(sent[0]!.address).toBe("93.184.216.34");
    expect(new Headers(sent[0]!.init.headers).get("authorization")).toBe("Bearer t");
    expect(sent[0]!.init.redirect).toBe("manual");
  });

  it("takes a Request as input, as the SDK may pass one", async () => {
    const f = createGuardedFetch({ maxBytes: 1000, lookup: dns({ "mcp.example.com": "93.184.216.34" }), send: answer(200) });
    await f(new Request("https://mcp.example.com/mcp", { method: "POST", headers: { "x-a": "1" }, body: "{}" }));
    expect(sent[0]!.init.method).toBe("POST");
    expect(new Headers(sent[0]!.init.headers).get("x-a")).toBe("1");
  });
});
