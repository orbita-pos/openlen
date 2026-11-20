// @vitest-environment node
//
// The person's yes to a phone sign-in (spec local 2026-11-17-oauth-de-conectores-mcp, §10.1, final review F5): the
// way-back page's form posts its one-time token here with «connect» or «discard». Only OpenLen's own page may post it,
// and the answer is the same result page as the way back. The flow itself (the held tokens, once, ten minutes) is tested
// on the real store in lib/mcp-connectors/oauth/flow.test.ts; here it is mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

const fake = vi.hoisted(() => ({
  result: { ok: true, server: "cal" } as
    | { ok: true; server: string }
    | { ok: false; reason: "expired" | "unknown" | "discarded" | "changed" | "other_account"; server?: string },
  calls: [] as unknown[],
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
  confirmSignIn: async (token: string, answer: string, sessionPersonId: string | null) => {
    fake.calls.push({ token, answer, sessionPersonId });
    return fake.result;
  },
}));

const { auth } = await import("@/auth");
const { POST } = await import("./route");

const post = (form: Record<string, string>, headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) =>
  POST(
    new Request("https://openlen.test/api/mcp-connectors/oauth/confirm", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: "NEXT_LOCALE=en", ...headers },
      body: new URLSearchParams(form).toString(),
    }),
  );

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://openlen.test");
  vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue(null);
  fake.result = { ok: true, server: "cal" };
  fake.calls.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/mcp-connectors/oauth/confirm", () => {
  it("«Connect to this account» hands the flow the token, the answer and this browser's session, and says connected", async () => {
    const res = await post({ token: "tok", answer: "connect" });
    expect(res.status).toBe(200);
    expect(fake.calls).toEqual([{ token: "tok", answer: "connect", sessionPersonId: null }]);
    const html = await res.text();
    expect(html).toContain("Connected.");
    expect(html).not.toContain("tok");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("«This isn't me» discards: «not connected, nothing saved»", async () => {
    fake.result = { ok: false, reason: "discarded", server: "cal" };
    const res = await post({ token: "tok", answer: "discard" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Nothing was saved");
  });

  it("an expired or spent token says so; another account's browser is refused", async () => {
    fake.result = { ok: false, reason: "expired" };
    expect(await (await post({ token: "tok", answer: "connect" })).text()).toContain("has expired or was already used");
    fake.result = { ok: false, reason: "other_account", server: "cal" };
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({ user: { id: "u2" } });
    const res = await post({ token: "tok", answer: "connect" });
    expect(res.status).toBe(403);
    expect(fake.calls.at(-1)).toEqual({ token: "tok", answer: "connect", sessionPersonId: "u2" });
  });

  it("🔴 a post from another site never reaches the flow", async () => {
    const posts: Record<string, string>[] = [{ "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }, { origin: "https://evil.example" }];
    for (const headers of posts) {
      const res = await post({ token: "tok", answer: "connect" }, headers);
      expect(res.status, JSON.stringify(headers)).toBe(403);
    }
    expect(fake.calls).toEqual([]);
  });

  it("OpenLen's own page posts: same-origin by fetch metadata, or its origin, or a no-referrer page's null origin", async () => {
    await post({ token: "tok", answer: "connect" }, { "sec-fetch-site": "same-origin" });
    await post({ token: "tok", answer: "connect" }, { origin: "https://openlen.test" });
    await post({ token: "tok", answer: "connect" }, { origin: "null" });
    expect(fake.calls).toHaveLength(3);
  });

  it("a form without a token or with another answer is refused before the flow", async () => {
    expect((await post({ answer: "connect" })).status).toBe(400);
    expect((await post({ token: "tok", answer: "maybe" })).status).toBe(400);
    expect(fake.calls).toEqual([]);
  });

  it("404 with OAuth off", async () => {
    vi.stubEnv("OPENLEN_MCP_OAUTH", "0");
    expect((await post({ token: "tok", answer: "connect" })).status).toBe(404);
    expect(fake.calls).toEqual([]);
  });
});
