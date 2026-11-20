// @vitest-environment node
//
// The OAuth return page and OpenLen's Client ID Metadata Document (spec local 2026-11-17-oauth-de-conectores-mcp, §5.2,
// §5.4 step 3, §10.1): minimal HTML with `postMessage` and strict headers, never echoing `code` or a token, and
// `/oauth/mcp-client.json` naming its own URL as `client_id`.
import vm from "node:vm";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

const fake = vi.hoisted(() => ({
  finishResult: { ok: true, server: "cal" } as
    | { ok: true; server: string }
    | { ok: false; reason: "expired" | "used" | "unknown" | "denied" | "changed" | "issuer_changed" | "exchange_failed"; server?: string },
  finishedWith: [] as unknown[],
}));

vi.mock("@/lib/mcp-connectors/real", () => ({
  realOAuthDeps: () => ({ siteUrl: "https://openlen.test" }),
  realMountDeps: () => ({}),
}));
vi.mock("@/lib/mcp-connectors/store", () => ({
  readMcpConfig: async () => ({ text: "{}", approved: {}, version: 1 }),
}));
vi.mock("@/lib/mcp-connectors/mount", () => ({
  mountServer: async () => null,
}));
vi.mock("@/lib/mcp-connectors/oauth/flow", () => ({
  finishSignIn: async (q: unknown, sessionPersonId: string | null) => {
    fake.finishedWith.push({ q, sessionPersonId });
    return fake.finishResult;
  },
}));

const { auth } = await import("@/auth");
const { GET } = await import("./route");
const { GET: getClientMetadata } = await import("@/app/oauth/mcp-client.json/route");

beforeEach(() => {
  vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({ user: { id: "u1" } });
  fake.finishResult = { ok: true, server: "cal" };
  fake.finishedWith.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/mcp-connectors/oauth/callback", () => {
  it("unknown state returns 400 and an error page with strict headers", async () => {
    fake.finishResult = { ok: false, reason: "unknown" };
    const res = await GET(new Request("https://openlen.test/api/mcp-connectors/oauth/callback?state=bad&code=secret_code_123"));
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; script-src 'unsafe-inline'");
    const html = await res.text();
    expect(html).not.toContain("secret_code_123");
    expect(html).not.toContain("code=");
  });

  // What it does to the server (still needs-auth, failures untouched, state spent, nothing mounted) is asserted on the
  // real flow and tables in route.denied.pglite.test.ts: this file mocks the flow, so it can only see the page.
  it("🔴 access_denied returns 200 «not connected», handing the flow the denial and no code (Review Focus 4)", async () => {
    fake.finishResult = { ok: false, reason: "denied", server: "cal" };
    const res = await GET(
      new Request("https://openlen.test/api/mcp-connectors/oauth/callback?state=s1&error=access_denied", {
        headers: { cookie: "NEXT_LOCALE=es" },
      }),
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("No se conectó");
    expect(html).toContain('"ok":false');
    expect(fake.finishedWith).toEqual([{ q: { state: "s1", error: "access_denied" }, sessionPersonId: "u1" }]);
  });

  it("successful callback posts openlen:mcp-oauth with ok: true and never contains code= or a token", async () => {
    fake.finishResult = { ok: true, server: "cal" };
    const res = await GET(
      new Request("https://openlen.test/api/mcp-connectors/oauth/callback?state=s1&code=one_time_code_xyz&iss=https://accounts.google.com", {
        headers: { cookie: "NEXT_LOCALE=es" },
      }),
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('"type":"openlen:mcp-oauth"');
    expect(html).toContain('"server":"cal"');
    expect(html).toContain('"ok":true');
    expect(html).toContain("Ya puedes volver a OpenLen");
    expect(html).not.toContain("one_time_code_xyz");
    expect(html).not.toContain("code=");
    expect(html).not.toContain("s1");
  });
});

// Review fix OB3: the provider's pages (or a Cross-Origin-Opener-Policy) may have cut the opener off, so the page tells the
// workspace on a same-origin BroadcastChannel as well, and with postMessage to the opener as a fallback. The page's own
// script is run here against a fake window to see what it really does.
describe("what the return page's script does", () => {
  async function runPage(opts: { opener?: boolean; channel?: "works" | "missing" | "throws" } = {}) {
    fake.finishResult = { ok: true, server: "cal" };
    const res = await GET(new Request("https://openlen.test/api/mcp-connectors/oauth/callback?state=s1&code=c"));
    const html = await res.text();
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;
    const onChannel: { name: string; data: unknown; closedAfter: boolean }[] = [];
    const toOpener: { data: unknown; origin: string }[] = [];
    const timers: (() => void)[] = [];
    const closed = { times: 0 };
    class Channel {
      posted: unknown[] = [];
      constructor(readonly name: string) {
        if (opts.channel === "throws") throw new Error("not allowed");
      }
      postMessage(data: unknown) {
        onChannel.push({ name: this.name, data, closedAfter: false });
      }
      close() {}
    }
    const sandbox: Record<string, unknown> = {
      window: {
        opener: opts.opener === false ? null : { postMessage: (data: unknown, origin: string) => toOpener.push({ data, origin }) },
        close: () => {
          closed.times++;
        },
      },
      location: { origin: "https://openlen.test" },
      setTimeout: (fn: () => void) => timers.push(fn),
      ...(opts.channel === "missing" ? {} : { BroadcastChannel: Channel }),
    };
    vm.runInNewContext(script, sandbox);
    return { onChannel, toOpener, closed, runTimers: () => timers.splice(0).forEach((t) => t()) };
  }
  const PAYLOAD = { type: "openlen:mcp-oauth", server: "cal", ok: true };

  it("posts on the openlen:mcp-oauth channel and to the opener, then closes itself", async () => {
    const page = await runPage();
    expect(page.onChannel).toEqual([expect.objectContaining({ name: "openlen:mcp-oauth", data: PAYLOAD })]);
    expect(page.toOpener).toEqual([{ data: PAYLOAD, origin: "https://openlen.test" }]);
    // Not at once: the channel's message is on its way before the window goes.
    expect(page.closed.times).toBe(0);
    page.runTimers();
    expect(page.closed.times).toBe(1);
  });

  it("🔴 reaches the workspace through the channel when the opener was cut off", async () => {
    const page = await runPage({ opener: false });
    expect(page.onChannel).toHaveLength(1);
    expect(page.toOpener).toEqual([]);
    page.runTimers();
    expect(page.closed.times).toBe(1);
  });

  it("falls back to the opener when the browser has no channel or refuses one", async () => {
    for (const channel of ["missing", "throws"] as const) {
      const page = await runPage({ channel });
      expect(page.onChannel, channel).toEqual([]);
      expect(page.toOpener, channel).toEqual([{ data: PAYLOAD, origin: "https://openlen.test" }]);
      page.runTimers();
      expect(page.closed.times, channel).toBe(1);
    }
  });
});

describe("GET /oauth/mcp-client.json", () => {
  it("serves OpenLen's Client ID Metadata Document with client_id equal to its own URL and public cache", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://openlen.com");
    const res = getClientMetadata();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    const doc = await res.json();
    expect(doc).toEqual({
      client_id: "https://openlen.com/oauth/mcp-client.json",
      client_name: "OpenLen",
      redirect_uris: ["https://openlen.com/api/mcp-connectors/oauth/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  });
});
