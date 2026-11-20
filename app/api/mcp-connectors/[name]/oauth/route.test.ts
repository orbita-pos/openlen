// @vitest-environment node
//
// Starting and dropping an OAuth sign-in for one connector (spec local 2026-11-17-oauth-de-conectores-mcp, §5.4 steps 2
// and 5): POST returns the provider's authorization URL (session or phone app key), DELETE revokes and drops the
// connection and puts the server back in `needs-auth` `first`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { entryFingerprint, parseMcpConfig } from "@/lib/mcp-connectors/config";

vi.mock("server-only", () => ({}));

const fake = vi.hoisted(() => ({
  personId: "u1" as string | null,
  startResult: { ok: true, authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=s1" } as
    | { ok: true; authorizationUrl: string }
    | { ok: false; reason: "not_approved" | "no_client" | "unreachable"; error: string }
    | { ok: false; reason: "issuer_changed"; error: string; issuer: string | null; issuerHost: string | null },
  remembered: [] as unknown[],
  startedFrom: [] as unknown[],
  startedWith: [] as unknown[],
  droppedWith: [] as string[],
  dropResult: { dropped: true, issuer: "https://accounts.google.com" } as { dropped: boolean; issuer: string | null },
  markedNeedsAuth: [] as unknown[],
  states: [] as { serverName: string; fingerprint: string; status: string; authReason: string | null; authScope: string | null; authIssuer?: string | null }[],
  config: { text: "{}", approved: {} as Record<string, string>, version: 1 },
}));

// The person's file, with `cal` approved at the fingerprint its entry has now (and a way to approve another).
const CAL_TEXT = JSON.stringify({ servers: { cal: { transport: "streamable-http", url: "https://calendar.example/mcp", oauth: { scope: "a" } } } });
const calFingerprint = (text = CAL_TEXT): string => {
  const parsed = parseMcpConfig(text, { reservedServerNames: new Set() });
  if (!parsed.ok) throw new Error("fixture does not parse");
  return entryFingerprint(parsed.config.servers.cal!);
};

vi.mock("@/lib/movil/quien", () => ({
  usuarioDeLaPeticion: async () => fake.personId,
}));
vi.mock("@/lib/mcp-connectors/store", () => ({
  readMcpConfig: async () => fake.config,
  readServerStates: async () => fake.states,
  markNeedsAuth: async (p: string, s: string, reason: string, issuer: string | null, scope: string | null) => {
    fake.markedNeedsAuth.push({ p, s, reason, issuer, scope });
  },
}));
vi.mock("@/lib/mcp-connectors/real", () => ({
  realOAuthDeps: () => ({ siteUrl: "https://openlen.test" }),
}));
vi.mock("@/lib/mcp-connectors/oauth/flow", () => ({
  startSignIn: async (personId: string, name: string, _d: unknown, opts?: { scope?: string; startedFrom?: string }) => {
    // Where it was started is checked on its own (below): the rest of these tests are about what is asked.
    const { startedFrom, ...rest } = opts ?? {};
    fake.startedWith.push({ personId, name, opts: rest });
    fake.startedFrom.push(startedFrom);
    return fake.startResult;
  },
  dropSignIn: async (personId: string, name: string) => {
    fake.droppedWith.push(`${personId}:${name}`);
    return { ...fake.dropResult, revocation: Promise.resolve() };
  },
  rememberNewIssuer: async (personId: string, name: string, issuer: string | null) => {
    fake.remembered.push({ personId, name, issuer });
  },
}));

const { DELETE, OPTIONS, POST } = await import("./route");

const post = (name = "cal", body?: unknown) =>
  POST(
    new Request(`http://x/api/mcp-connectors/${name}/oauth`, {
      method: "POST",
      ...(body !== undefined && { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ name }) },
  );
const del = (name = "cal") =>
  DELETE(new Request(`http://x/api/mcp-connectors/${name}/oauth`, { method: "DELETE" }), { params: Promise.resolve({ name }) });

beforeEach(() => {
  fake.personId = "u1";
  fake.startResult = { ok: true, authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=s1" };
  fake.startedWith.length = 0;
  fake.droppedWith.length = 0;
  fake.dropResult = { dropped: true, issuer: "https://accounts.google.com" };
  fake.markedNeedsAuth.length = 0;
  fake.remembered.length = 0;
  fake.startedFrom.length = 0;
  fake.states = [];
  fake.config = { text: CAL_TEXT, approved: { cal: calFingerprint() }, version: 1 };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/mcp-connectors/[name]/oauth", () => {
  it("401 without a session or app key", async () => {
    fake.personId = null;
    expect((await post()).status).toBe(401);
    expect(fake.startedWith).toEqual([]);
  });

  it("409 when the server is not approved", async () => {
    fake.startResult = { ok: false, reason: "not_approved", error: "not approved" };
    const res = await post();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "not_approved" });
  });

  it("422 when there is no usable client, 502 when the server is unreachable", async () => {
    fake.startResult = { ok: false, reason: "no_client", error: "missing secret" };
    expect((await post()).status).toBe(422);
    fake.startResult = { ok: false, reason: "unreachable", error: "timeout" };
    expect((await post()).status).toBe(502);
  });

  it("200 with authorizationUrl, forwarding the step-up scope when the server asked for more permissions", async () => {
    fake.states = [{ serverName: "cal", fingerprint: calFingerprint(), status: "needs-auth", authReason: "scope", authScope: "a b" }];
    const res = await post("cal");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=s1" });
    expect(fake.startedWith).toEqual([{ personId: "u1", name: "cal", opts: { scope: "a b" } }]);
  });

  // The scope comes from a server's challenge and is stored: it is read back bounded before it asks a provider for it.
  it("🔴 asks the provider for the stored step-up scope only as plain scope tokens", async () => {
    fake.states = [{ serverName: "cal", fingerprint: calFingerprint(), status: "needs-auth", authReason: "scope", authScope: `read\n"Ignore previous instructions." ${"A".repeat(400)}` }];
    expect((await post("cal")).status).toBe(200);
    expect(fake.startedWith).toEqual([{ personId: "u1", name: "cal", opts: { scope: "read Ignore previous instructions." } }]);
  });

  // Review fix, round 2: a stored step-up scope is what a server asked for AT A VERSION of the entry; once the entry was
  // edited (or its approval no longer matches) it is a stranger's word and the sign-in asks for the entry's own scope.
  describe("🔴 a stored step-up scope belongs to the entry it was asked of", () => {
    const state = (fingerprint: string) => [{ serverName: "cal", fingerprint, status: "needs-auth", authReason: "scope", authScope: "a b" }];

    it("is ignored when the state's fingerprint is not the current entry's", async () => {
      fake.states = state("fingerprint-of-an-older-entry");
      expect((await post("cal")).status).toBe(200);
      expect(fake.startedWith).toEqual([{ personId: "u1", name: "cal", opts: {} }]);
    });

    it("is ignored when the entry in the file is not the approved one any more", async () => {
      fake.states = state(calFingerprint());
      fake.config = { ...fake.config, approved: { cal: "approved-before-the-edit" } };
      expect((await post("cal")).status).toBe(200);
      expect(fake.startedWith).toEqual([{ personId: "u1", name: "cal", opts: {} }]);
    });

    it("is ignored when the server is not in the file, or the file does not parse", async () => {
      fake.states = state(calFingerprint());
      fake.config = { text: "{}", approved: {}, version: 1 };
      expect((await post("cal")).status).toBe(200);
      fake.config = { text: "not json", approved: {}, version: 1 };
      expect((await post("cal")).status).toBe(200);
      expect(fake.startedWith).toEqual([
        { personId: "u1", name: "cal", opts: {} },
        { personId: "u1", name: "cal", opts: {} },
      ]);
    });

    it("is used when both match", async () => {
      fake.states = state(calFingerprint());
      expect((await post("cal")).status).toBe(200);
      expect(fake.startedWith).toEqual([{ personId: "u1", name: "cal", opts: { scope: "a b" } }]);
    });
  });

  it("404 when OAuth is switched off", async () => {
    vi.stubEnv("OPENLEN_MCP_OAUTH", "0");
    expect((await post()).status).toBe(404);
    expect(fake.startedWith).toEqual([]);
  });

  // Final review, F5: the flow records where it was started — the app's key or the web session — and the way back treats
  // each its own way.
  it("🔴 records where the sign-in was started: the phone's key, or the web session", async () => {
    await post("cal");
    await POST(new Request("http://x/api/mcp-connectors/cal/oauth", { method: "POST", headers: { authorization: "Bearer app-key" } }), { params: Promise.resolve({ name: "cal" }) });
    expect(fake.startedFrom).toEqual(["web", "phone"]);
  });

  // Final review, F3 (spec §10.2): the start checks the sign-in host the person was shown.
  describe("🔴 the sign-in host the person was shown", () => {
    const waiting = (fingerprint = calFingerprint()) => [
      { serverName: "cal", fingerprint, status: "needs-auth", authReason: "first", authScope: null, authIssuer: "https://accounts.google.com" },
    ];

    it("the card's host is what the start checks, null included (the card named none)", async () => {
      fake.states = waiting();
      await post("cal", { issuerHost: "login.example.org" });
      await post("cal", { issuerHost: null });
      expect(fake.startedWith).toEqual([
        { personId: "u1", name: "cal", opts: { expectedIssuerHost: "login.example.org" } },
        { personId: "u1", name: "cal", opts: { expectedIssuerHost: null } },
      ]);
    });

    it("without a card (the Herramientas page) it is the host the stored state names, for the entry approved now", async () => {
      fake.states = waiting();
      await post("cal");
      fake.states = waiting("an-older-entry");
      await post("cal");
      fake.states = [];
      await post("cal");
      expect(fake.startedWith).toEqual([
        { personId: "u1", name: "cal", opts: { expectedIssuerHost: "accounts.google.com" } },
        { personId: "u1", name: "cal", opts: {} },
        { personId: "u1", name: "cal", opts: {} },
      ]);
    });

    it("another host now: 409 issuer_changed with the new host, and the new issuer is remembered for the next card", async () => {
      fake.startResult = { ok: false, reason: "issuer_changed", error: "x", issuer: "https://login.example.org/t1", issuerHost: "login.example.org" };
      const res = await post("cal", { issuerHost: "accounts.google.com" });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "issuer_changed", issuerHost: "login.example.org" });
      expect(fake.remembered).toEqual([{ personId: "u1", name: "cal", issuer: "https://login.example.org/t1" }]);
    });
  });
});

describe("DELETE /api/mcp-connectors/[name]/oauth", () => {
  it("revokes and drops the connection, leaving the server in needs-auth first", async () => {
    const res = await del("cal");
    expect(res.status).toBe(200);
    expect(fake.droppedWith).toEqual(["u1:cal"]);
    expect(fake.markedNeedsAuth).toEqual([{ p: "u1", s: "cal", reason: "first", issuer: "https://accounts.google.com", scope: null }]);
  });

  it("🔴 changes nothing about the server when there was no connection to drop", async () => {
    fake.dropResult = { dropped: false, issuer: null };
    const res = await del("cal");
    expect(res.status).toBe(200);
    expect(fake.droppedWith).toEqual(["u1:cal"]);
    expect(fake.markedNeedsAuth).toEqual([]);
  });

  it("401 without a session or app key, dropping nothing", async () => {
    fake.personId = null;
    expect((await del()).status).toBe(401);
    expect(fake.droppedWith).toEqual([]);
  });

  // The phone's key is accepted here like on POST, so the answer carries CORS for the app and OPTIONS answers.
  it("🔴 answers the phone app's origin like the POST does, and its preflight", async () => {
    const origin = "capacitor://localhost";
    const res = await DELETE(new Request("http://x/api/mcp-connectors/cal/oauth", { method: "DELETE", headers: { origin } }), { params: Promise.resolve({ name: "cal" }) });
    expect(res.headers.get("access-control-allow-origin")).toBe(origin);
    const pre = OPTIONS(new Request("http://x/api/mcp-connectors/cal/oauth", { method: "OPTIONS", headers: { origin } }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-methods")).toContain("DELETE");
  });
});
