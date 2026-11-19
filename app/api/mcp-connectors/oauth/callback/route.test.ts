// @vitest-environment node
//
// The OAuth return page and OpenLen's Client ID Metadata Document (spec local 2026-11-17-oauth-de-conectores-mcp, §5.2,
// §5.4 step 3, §10.1): minimal HTML with `postMessage` and strict headers, never echoing `code` or a token, and
// `/oauth/mcp-client.json` naming its own URL as `client_id`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

const fake = vi.hoisted(() => ({
  finishResult: { ok: true, server: "cal" } as
    | { ok: true; server: string }
    | { ok: false; reason: "expired" | "used" | "unknown" | "denied" | "changed" | "issuer_changed" | "exchange_failed"; server?: string },
  finishedWith: [] as unknown[],
  serverState: {
    serverName: "cal",
    status: "needs-auth",
    failures: 2,
    authReason: "first",
    authIssuer: "https://accounts.google.com",
  },
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
  fake.serverState = {
    serverName: "cal",
    status: "needs-auth",
    failures: 2,
    authReason: "first",
    authIssuer: "https://accounts.google.com",
  };
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

  it("🔴 access_denied returns 200 «not connected» and leaves the server in needs-auth with failures untouched (Review Focus 4)", async () => {
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
    expect(fake.serverState.status).toBe("needs-auth");
    expect(fake.serverState.failures).toBe(2);
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
