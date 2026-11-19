// @vitest-environment node
//
// Starting and dropping an OAuth sign-in for one connector (spec local 2026-11-17-oauth-de-conectores-mcp, §5.4 steps 2
// and 5): POST returns the provider's authorization URL (session or phone app key), DELETE revokes and drops the
// connection and puts the server back in `needs-auth` `first`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const fake = vi.hoisted(() => ({
  personId: "u1" as string | null,
  startResult: { ok: true, authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=s1" } as
    | { ok: true; authorizationUrl: string }
    | { ok: false; reason: "not_approved" | "no_client" | "unreachable"; error: string },
  startedWith: [] as unknown[],
  droppedWith: [] as string[],
  markedNeedsAuth: [] as unknown[],
  states: [] as { serverName: string; status: string; authReason: string | null; authScope: string | null }[],
}));

vi.mock("@/lib/movil/quien", () => ({
  usuarioDeLaPeticion: async () => fake.personId,
}));
vi.mock("@/lib/mcp-connectors/store", () => ({
  readMcpConfig: async () => ({ text: "{}", approved: {}, version: 1 }),
  readServerStates: async () => fake.states,
  markNeedsAuth: async (p: string, s: string, reason: string, issuer: string | null, scope: string | null) => {
    fake.markedNeedsAuth.push({ p, s, reason, issuer, scope });
  },
}));
vi.mock("@/lib/mcp-connectors/real", () => ({
  realOAuthDeps: () => ({ siteUrl: "https://openlen.test" }),
}));
vi.mock("@/lib/mcp-connectors/oauth/flow", () => ({
  startSignIn: async (personId: string, name: string, _d: unknown, opts?: { scope?: string }) => {
    fake.startedWith.push({ personId, name, opts });
    return fake.startResult;
  },
  dropSignIn: async (personId: string, name: string) => {
    fake.droppedWith.push(`${personId}:${name}`);
    return { dropped: true, issuer: "https://accounts.google.com" };
  },
}));

const { DELETE, POST } = await import("./route");

const post = (name = "cal") =>
  POST(new Request(`http://x/api/mcp-connectors/${name}/oauth`, { method: "POST" }), { params: Promise.resolve({ name }) });
const del = (name = "cal") =>
  DELETE(new Request(`http://x/api/mcp-connectors/${name}/oauth`, { method: "DELETE" }), { params: Promise.resolve({ name }) });

beforeEach(() => {
  fake.personId = "u1";
  fake.startResult = { ok: true, authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=s1" };
  fake.startedWith.length = 0;
  fake.droppedWith.length = 0;
  fake.markedNeedsAuth.length = 0;
  fake.states = [];
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
    fake.states = [{ serverName: "cal", status: "needs-auth", authReason: "scope", authScope: "a b" }];
    const res = await post("cal");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=s1" });
    expect(fake.startedWith).toEqual([{ personId: "u1", name: "cal", opts: { scope: "a b" } }]);
  });

  it("404 when OAuth is switched off", async () => {
    vi.stubEnv("OPENLEN_MCP_OAUTH", "0");
    expect((await post()).status).toBe(404);
    expect(fake.startedWith).toEqual([]);
  });
});

describe("DELETE /api/mcp-connectors/[name]/oauth", () => {
  it("revokes and drops the connection, leaving the server in needs-auth first", async () => {
    const res = await del("cal");
    expect(res.status).toBe(200);
    expect(fake.droppedWith).toEqual(["u1:cal"]);
    expect(fake.markedNeedsAuth).toEqual([{ p: "u1", s: "cal", reason: "first", issuer: "https://accounts.google.com", scope: null }]);
  });
});
