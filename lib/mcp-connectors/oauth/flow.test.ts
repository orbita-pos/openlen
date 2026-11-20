// @vitest-environment node
//
// Signing in to an MCP server with the SDK's OAuth, server-side (spec local 2026-11-17-oauth-de-conectores-mcp, §5.2–5.4,
// §10.1, §10.2, §10.6): `startSignIn` / `finishSignIn` and the connection provider, end to end against a fake MCP server
// with its own authorization server on 127.0.0.1, and the real store over PGlite.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";

import type { MountDeps } from "../mount";
import type { ServerState } from "../store";

process.env.NEXTAUTH_SECRET ??= "test-secret-for-oauth-flow";

const base = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", async () => {
  const s = await import("@/lib/db/schema");
  return {
    schema: s,
    get db() {
      return base.db;
    },
  };
});

const { CREATE_MCP_CONNECTORS } = await import("@/scripts/mcp-connectors-migrate-sql");
const store = await import("./store");
const { REVOKE_TIMEOUT_MS, dropSignIn, finishSignIn, rememberNewIssuer, startSignIn } = await import("./flow");
const { connectionProvider, NeedsSignIn } = await import("./provider");
const { openMcp } = await import("../client");
const { mountServer, serversToMount, retryDelayMs } = await import("../mount");
const { connectorsForTurn } = await import("../turn");
const { entryFingerprint, parseMcpConfig } = await import("../config");
const { startFakeAuthServer } = await import("./fake-auth-server");
type FakeAuthServer = Awaited<ReturnType<typeof startFakeAuthServer>>;

const NOW = new Date("2026-11-17T10:00:00Z");
const SITE = "https://openlen.test";
const CALLBACK = `${SITE}/api/mcp-connectors/oauth/callback`;

let pg: PGlite;
let fake: FakeAuthServer;
let clock: Date;
let config: { text: string; approved: Record<string, string>; version: number };
let creds: Map<string, string>;
let mounted: string[];

beforeEach(async () => {
  pg = new PGlite();
  await pg.query(`CREATE TABLE "users" ("id" text PRIMARY KEY);`);
  await pg.query(`INSERT INTO "users" ("id") VALUES ('p1'), ('p2');`);
  for (const statement of CREATE_MCP_CONNECTORS) await pg.query(statement);
  base.db = drizzle(pg, { schema });
  clock = NOW;
  fake = await startFakeAuthServer({ now: () => clock, origin: "https://mcp.fake.test" });
  creds = new Map();
  mounted = [];
  setServer({});
});

afterEach(async () => {
  await fake.close();
});

/** Writes `cal` into the person's mcp.json, approved as it is. */
function setServer(over: Record<string, unknown>, opts: { approve?: boolean } = {}) {
  const raw = { transport: "streamable-http", url: fake.mcpUrl, headers: {}, ...over };
  const text = JSON.stringify({ servers: { cal: raw } });
  const parsed = parseMcpConfig(text, { reservedServerNames: new Set() });
  if (!parsed.ok) throw new Error(parsed.error);
  config = { text, approved: opts.approve === false ? {} : { cal: entryFingerprint(parsed.config.servers.cal!) }, version: (config?.version ?? 0) + 1 };
}

function entryNow() {
  const parsed = parseMcpConfig(config.text, { reservedServerNames: new Set() });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.config.servers.cal!;
}

const deps = () => ({
  store,
  fetch: fake.fetch,
  siteUrl: SITE,
  async resolveCredentials(_personId: string, names: readonly string[]) {
    return new Map(names.filter((n) => creds.has(n)).map((n) => [n, creds.get(n)!] as [string, string]));
  },
  now: () => clock,
  env: {},
  async readConfig() {
    return config;
  },
  async mount(_personId: string, name: string) {
    mounted.push(name);
    return null;
  },
});

async function start(person = "p1") {
  const r = await startSignIn(person, "cal", deps());
  if (!r.ok) throw new Error(`start failed: ${r.reason} ${r.error}`);
  return r.authorizationUrl;
}

/** The whole sign-in: start, the person at the provider, the way back. */
async function signIn() {
  const back = await fake.authorize(await start());
  return finishSignIn({ state: back.state!, code: back.code!, iss: back.iss! }, "p1", deps());
}

const connect = () => openMcp({ url: fake.mcpUrl, headers: {} }, { fetch: fake.fetch, timeoutMs: 5000, authProvider: connectionProvider("p1", "cal", entryNow(), deps()) });
const stored = () => store.loadConnection("p1", "cal", fake.mcpUrl, fake.issuer, entryFingerprint(entryNow()));

describe("signing in", () => {
  it("start then finish connects", async () => {
    const url = new URL(await start());
    expect(`${url.origin}${url.pathname}`).toBe(`${fake.issuer}/authorize`);
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("resource")).toBe(fake.mcpUrl);
    expect(url.searchParams.get("redirect_uri")).toBe(CALLBACK);
    const back = await fake.authorize(url.toString());
    expect(back.state).toBe(url.searchParams.get("state"));
    expect(await finishSignIn({ state: back.state!, code: back.code!, iss: back.iss! }, "p1", deps())).toEqual({ ok: true, server: "cal" });
    expect((await stored())?.tokens?.access_token).toMatch(/^at_/);
    expect(mounted).toEqual(["cal"]);
    // Connecting now sends the token.
    const c = await connect();
    expect((await c.listTools()).map((t) => t.name)).toEqual(["ping"]);
    await c.close();
  });

  it("uses dynamic registration when there is no client", async () => {
    await signIn();
    expect(fake.registrations).toHaveLength(1);
    expect(fake.registrations[0]).toMatchObject({ client_name: "OpenLen", redirect_uris: [CALLBACK] });
  });

  it("a second sign-in reuses the client registered the first time", async () => {
    await signIn();
    await signIn();
    expect(fake.registrations).toHaveLength(1);
  });

  it("uses the entry's clientId and never registers", async () => {
    fake.addClient("own-client");
    setServer({ oauth: { clientId: "own-client" } });
    const url = new URL(await start());
    expect(url.searchParams.get("client_id")).toBe("own-client");
    const back = await fake.authorize(url.toString());
    expect(await finishSignIn({ state: back.state!, code: back.code!, iss: back.iss! }, "p1", deps())).toEqual({ ok: true, server: "cal" });
    expect(fake.registrations).toHaveLength(0);
    expect((await stored())?.tokens).not.toBeNull();
  });

  it("an entry's confidential client sends its secret to the token endpoint, and the row doesn't keep it", async () => {
    fake.addClient("own-client", "own-secret-value");
    creds.set("CAL_SECRET", "own-secret-value");
    setServer({ oauth: { clientId: "own-client", clientSecret: "${credential:CAL_SECRET}", authorizationServer: [fake.issuer] } });
    expect(await signIn()).toEqual({ ok: true, server: "cal" });
    expect((await stored())?.clientInfo).not.toHaveProperty("client_secret");
  });

  it("a missing client secret refuses to start", async () => {
    setServer({ oauth: { clientId: "own-client", clientSecret: "${credential:CAL_SECRET}", authorizationServer: [fake.issuer] } });
    expect(await startSignIn("p1", "cal", deps())).toEqual({ ok: false, reason: "no_client", error: "missing: CAL_SECRET" });
  });

  it("an issuer the entry's client isn't for refuses to start, and the secret is never sent", async () => {
    creds.set("CAL_SECRET", "own-secret-value");
    setServer({ oauth: { clientId: "own-client", clientSecret: "${credential:CAL_SECRET}", authorizationServer: ["https://accounts.google.com"] } });
    const r = await startSignIn("p1", "cal", deps());
    expect(r).toMatchObject({ ok: false, reason: "no_client" });
    expect(JSON.stringify(r)).not.toContain("own-secret-value");
    expect(fake.tokenRequests).toHaveLength(0);
  });

  it("a server the person hasn't approved doesn't start", async () => {
    setServer({}, { approve: false });
    expect(await startSignIn("p1", "cal", deps())).toMatchObject({ ok: false, reason: "not_approved" });
    expect(await startSignIn("p1", "other", deps())).toMatchObject({ ok: false, reason: "not_approved" });
  });

  // Final review, F3 (spec §10.2): the card named where the person signs in, from an earlier mount. The start checks the
  // host it would open against that one; another is refused before any flow exists, with where it is now.
  describe("the sign-in host the card named", () => {
    const flows = async () => (await pg.query(`SELECT count(*)::int AS n FROM "personMcpOAuthFlows"`)).rows[0] as { n: number };

    it("🔴 another host now: issuer_changed with the new issuer, and no flow is made", async () => {
      const r = await startSignIn("p1", "cal", deps(), { expectedIssuerHost: "accounts.example.org" });
      expect(r).toEqual({ ok: false, reason: "issuer_changed", issuer: fake.issuer, issuerHost: "mcp.fake.test", error: "the sign-in page is not the one the person was shown" });
      expect((await flows()).n).toBe(0);
      expect(fake.registrations).toHaveLength(0);
    });

    it("the same host starts", async () => {
      const r = await startSignIn("p1", "cal", deps(), { expectedIssuerHost: "mcp.fake.test" });
      expect(r).toMatchObject({ ok: true });
      expect((await flows()).n).toBe(1);
    });

    it("a card that named no host (the server's own sign-in page) made no promise: it starts", async () => {
      expect(await startSignIn("p1", "cal", deps(), { expectedIssuerHost: null })).toMatchObject({ ok: true });
      expect(await startSignIn("p1", "cal", deps(), {})).toMatchObject({ ok: true });
    });
  });

  it("a server with no authorization server is unreachable", async () => {
    setServer({ url: "https://mcp.fake.test/nowhere" });
    const d = { ...deps(), fetch: (async () => new Response("no", { status: 404 })) as typeof fetch };
    expect(await startSignIn("p1", "cal", d)).toMatchObject({ ok: false, reason: "unreachable" });
  });
});

// Disconnecting (spec §5.4 step 5): the person's connection is deleted FIRST — nothing that follows can keep it — and
// revoking the tokens at the provider (RFC 7009) is a courtesy done in the background, bounded and never raising.
describe("dropping a sign-in", () => {
  it("deletes the connection and revokes the refresh and the access token", async () => {
    await signIn();
    const tokens = (await stored())!.tokens!;
    const r = await dropSignIn("p1", "cal", deps());
    expect(r).toMatchObject({ dropped: true, issuer: fake.issuer });
    await r.revocation;
    expect(await stored()).toBeNull();
    expect(fake.revoked).toEqual([tokens.refresh_token, tokens.access_token]);
  });

  it("🔴 the connection is already gone when the revocation request leaves", async () => {
    await signIn();
    let storedWhenRevoking: unknown = "not asked";
    const d = {
      ...deps(),
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/revoke")) storedWhenRevoking = await stored();
        return fake.fetch(input, init);
      }) as typeof fetch,
    };
    await (await dropSignIn("p1", "cal", d)).revocation;
    expect(storedWhenRevoking).toBeNull();
  });

  it("revokes with the entry's own client, secret included", async () => {
    fake.addClient("own-client", "own-secret-value");
    creds.set("CAL_SECRET", "own-secret-value");
    setServer({ oauth: { clientId: "own-client", clientSecret: "${credential:CAL_SECRET}", authorizationServer: [fake.issuer] } });
    expect(await signIn()).toEqual({ ok: true, server: "cal" });
    await (await dropSignIn("p1", "cal", deps())).revocation;
    expect(fake.revokeRequests).toHaveLength(2);
    for (const form of fake.revokeRequests) {
      expect(form.get("client_id")).toBe("own-client");
      expect(form.get("client_secret")).toBe("own-secret-value");
    }
  });

  it("🔴 revokes nowhere when the authorization server is no longer the one the tokens came from", async () => {
    await signIn();
    fake.setIssuer("/moved");
    const r = await dropSignIn("p1", "cal", deps());
    expect(r.dropped).toBe(true);
    await r.revocation;
    expect(fake.revoked).toEqual([]);
    expect(await stored()).toBeNull();
  });

  // Review fix, round 1 (CRITICAL; the reviewer's probe): the entry handed to a drop is a hint from whoever removed or edited
  // it, never the connection's own. Revoking follows the metadata of an entry whose fingerprint is the one the person signed in
  // with — else the server's own RFC 9728 discovery — so a hostile entry can't make the tokens leave for its endpoints.
  describe("revoking only through the entry the connection was signed in with", () => {
    const GOOGLE = "https://accounts.google.com";
    const GCAL = "https://calendarmcp.googleapis.com/mcp/v1";
    const SIGNED_WITH = "fp-entry-signed-in-with";
    const hostileHint = {
      transport: "streamable-http",
      url: GCAL,
      headers: {},
      enabled: true,
      startupTimeoutMs: 30_000,
      toolCallTimeoutMs: 60_000,
      oauth: { clientId: "x", authServerMetadataUrl: "https://evil.example/meta" },
    } as const;

    it("🔴 a hint with another fingerprint is never followed: not its metadata URL, not its revocation endpoint", async () => {
      const fetched: string[] = [];
      const posted: string[] = [];
      const fakeStore = {
        dropConnection: async () => ({
          serverUrl: GCAL,
          issuer: GOOGLE,
          fingerprint: SIGNED_WITH,
          clientInfo: { client_id: "openlen-google-id" },
          tokens: { access_token: "ya29.PERSONS_ACCESS", refresh_token: "1//PERSONS_REFRESH", token_type: "Bearer" },
        }),
      } as unknown as ReturnType<typeof deps>["store"];
      const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        fetched.push(url);
        if (url === "https://evil.example/meta") {
          return new Response(
            JSON.stringify({
              issuer: GOOGLE,
              authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
              token_endpoint: "https://evil.example/token",
              revocation_endpoint: "https://evil.example/revoke",
              response_types_supported: ["code"],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (init?.method === "POST") posted.push(`${url} ${String(init.body)}`);
        return new Response("not found", { status: 404 });
      }) as typeof fetch;
      const r = await dropSignIn("p1", "google-calendar", { ...deps(), store: fakeStore, fetch: fetchFn }, hostileHint as never);
      expect(r.dropped).toBe(true);
      await r.revocation;
      expect(fetched.filter((u) => u.includes("evil.example"))).toEqual([]);
      expect(posted.filter((p) => p.includes("PERSONS"))).toEqual([]);
    });

    it("🔴 with the real store: the same hint after a real sign-in revokes through the server's own discovery, and nothing leaves for the hint", async () => {
      await signIn();
      const tokens = (await stored())!.tokens!;
      const seen: string[] = [];
      const watching = { ...deps(), fetch: ((input: RequestInfo | URL, init?: RequestInit) => (seen.push(String(input instanceof Request ? input.url : input)), fake.fetch(input, init))) as typeof fetch };
      const hint = { ...entryNow(), oauth: { clientId: "x", authServerMetadataUrl: "https://evil.example/meta" } };
      await (await dropSignIn("p1", "cal", watching, hint)).revocation;
      expect(seen.filter((u) => u.includes("evil.example"))).toEqual([]);
      expect(fake.revoked).toEqual([tokens.refresh_token, tokens.access_token]);
    });

    it("🔴 an edited entry in the person's file is not the connection's entry either: a drop without a hint revokes through the server's own discovery", async () => {
      await signIn();
      const tokens = (await stored())!.tokens!;
      setServer({ oauth: { clientId: "x", authServerMetadataUrl: "https://evil.example/meta" } });
      const seen: string[] = [];
      const watching = { ...deps(), fetch: ((input: RequestInfo | URL, init?: RequestInit) => (seen.push(String(input instanceof Request ? input.url : input)), fake.fetch(input, init))) as typeof fetch };
      await (await dropSignIn("p1", "cal", watching)).revocation;
      expect(seen.filter((u) => u.includes("evil.example"))).toEqual([]);
      expect(fake.revoked).toEqual([tokens.refresh_token, tokens.access_token]);
    });

    it("the connection's own entry (the hint with the same fingerprint) is followed, a manual metadata URL included", async () => {
      fake.metadataAt = "/custom/as-metadata.json";
      fake.addClient("own-client");
      setServer({ oauth: { clientId: "own-client", authServerMetadataUrl: `${fake.base}/custom/as-metadata.json` } });
      await signIn();
      const tokens = (await stored())!.tokens!;
      const seen: string[] = [];
      const watching = { ...deps(), fetch: ((input: RequestInfo | URL, init?: RequestInit) => (seen.push(String(input instanceof Request ? input.url : input)), fake.fetch(input, init))) as typeof fetch };
      await (await dropSignIn("p1", "cal", watching, entryNow())).revocation;
      expect(seen.some((u) => u.endsWith("/custom/as-metadata.json"))).toBe(true);
      expect(seen.filter((u) => u.includes(".well-known"))).toEqual([]);
      expect(fake.revoked).toEqual([tokens.refresh_token, tokens.access_token]);
    });
  });

  it("a connection with no tokens is deleted and nothing is revoked", async () => {
    await start();
    const r = await dropSignIn("p1", "cal", deps());
    expect(r.dropped).toBe(true);
    await r.revocation;
    expect(fake.revoked).toEqual([]);
  });

  it("a person with no connection drops nothing", async () => {
    const r = await dropSignIn("p1", "cal", deps());
    expect(r).toMatchObject({ dropped: false, issuer: null });
    await r.revocation;
    expect(fake.revoked).toEqual([]);
  });

  // The bound is native (`AbortSignal.timeout`), which fake timers don't drive: the test takes its place, pins the value it is
  // asked for, and plays out the five seconds by aborting the signal the request was given.
  it("🔴 a slow revocation doesn't hold the drop up, and is abandoned after REVOKE_TIMEOUT_MS", async () => {
    await signIn();
    expect(REVOKE_TIMEOUT_MS).toBe(5_000);
    const asked: number[] = [];
    const fiveSeconds = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      asked.push(ms);
      return fiveSeconds.signal;
    });
    try {
      // The revocation endpoint never answers, but its request honours the signal it was given.
      const hung = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (!String(input instanceof Request ? input.url : input).endsWith("/revoke")) return fake.fetch(input, init);
        return new Promise<Response>((_resolve, reject) => {
          // Like a real fetch: an aborted signal fails the request now, and an open one when it aborts.
          if (init?.signal?.aborted) reject(new Error("aborted"));
          else init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      }) as typeof fetch;
      const r = await dropSignIn("p1", "cal", { ...deps(), fetch: hung });
      expect(r.dropped).toBe(true);
      expect(await stored()).toBeNull();
      let over = false;
      void r.revocation.then(() => {
        over = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(over).toBe(false); // still waiting on the endpoint, and nobody waits for it
      expect(asked).toEqual([REVOKE_TIMEOUT_MS]);
      fiveSeconds.abort(); // the five seconds go by
      await r.revocation;
      expect(over).toBe(true);
    } finally {
      timeout.mockRestore();
    }
  });

  it("a failing revocation (a refused connection, a 500) never raises", async () => {
    await signIn();
    const refused = {
      ...deps(),
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/revoke")) throw new Error("connection refused");
        return fake.fetch(input, init);
      }) as typeof fetch,
    };
    const r = await dropSignIn("p1", "cal", refused);
    expect(r.dropped).toBe(true);
    await expect(r.revocation).resolves.toBeUndefined();

    await signIn();
    const broken = {
      ...deps(),
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input).endsWith("/revoke") ? new Response("boom", { status: 500 }) : fake.fetch(input, init)) as typeof fetch,
    };
    const again = await dropSignIn("p1", "cal", broken);
    expect(again.dropped).toBe(true);
    await expect(again.revocation).resolves.toBeUndefined();

    await signIn();
    const nowhere = { ...deps(), fetch: (async () => { throw new Error("no network"); }) as typeof fetch };
    await expect((await dropSignIn("p1", "cal", nowhere)).revocation).resolves.toBeUndefined();
  });
});

describe("the way back", () => {
  it("state of another session person is refused", async () => {
    const back = await fake.authorize(await start());
    expect(await finishSignIn({ state: back.state!, code: back.code! }, "otra-persona", deps())).toEqual({ ok: false, reason: "unknown" });
    expect(fake.tokenRequests).toHaveLength(0);
  });

  it("without a session the state alone is trusted", async () => {
    const back = await fake.authorize(await start());
    expect(await finishSignIn({ state: back.state!, code: back.code!, iss: back.iss! }, null, deps())).toEqual({ ok: true, server: "cal" });
  });

  it("denied by the person", async () => {
    const url = new URL(await start());
    const state = url.searchParams.get("state")!;
    expect(await finishSignIn({ state, error: "access_denied" }, "p1", deps())).toEqual({ ok: false, reason: "denied", server: "cal" });
    expect(await finishSignIn({ state, error: "access_denied" }, "p1", deps())).toEqual({ ok: false, reason: "used" });
  });

  it("a state nobody made is unknown, and one used twice is used", async () => {
    expect(await finishSignIn({ state: "nope", code: "x" }, "p1", deps())).toEqual({ ok: false, reason: "unknown" });
    const back = await fake.authorize(await start());
    const q = { state: back.state!, code: back.code!, iss: back.iss! };
    expect(await finishSignIn(q, "p1", deps())).toMatchObject({ ok: true });
    expect(await finishSignIn(q, "p1", deps())).toEqual({ ok: false, reason: "used" });
  });

  it("a sign-in finished after ten minutes is expired", async () => {
    const back = await fake.authorize(await start());
    clock = new Date(NOW.getTime() + 10 * 60 * 1000 + 1);
    expect(await finishSignIn({ state: back.state!, code: back.code!, iss: back.iss! }, "p1", deps())).toEqual({ ok: false, reason: "expired" });
  });

  it("entry changed while signing in", async () => {
    const back = await fake.authorize(await start());
    setServer({ url: `${fake.mcpUrl}?v=2` });
    expect(await finishSignIn({ state: back.state!, code: back.code!, iss: back.iss! }, "p1", deps())).toEqual({ ok: false, reason: "changed", server: "cal" });
    expect(fake.tokenRequests).toHaveLength(0);
  });

  it("entry no longer approved while signing in", async () => {
    const back = await fake.authorize(await start());
    config = { ...config, approved: {} };
    expect(await finishSignIn({ state: back.state!, code: back.code!, iss: back.iss! }, "p1", deps())).toEqual({ ok: false, reason: "changed", server: "cal" });
  });

  it("issuer changed, named by the iss on the way back (RFC 9207)", async () => {
    const url = await start();
    fake.setIssuer("/as2");
    const back = await fake.authorize(url);
    // Where the sign-in is now comes from the server's own discovery, for the next card (final review, F3).
    expect(await finishSignIn({ state: back.state!, code: back.code!, iss: back.iss! }, "p1", deps())).toEqual({
      ok: false,
      reason: "issuer_changed",
      server: "cal",
      personId: "p1",
      issuer: `${fake.base}/as2`,
      issuerHost: "mcp.fake.test",
    });
    expect(fake.tokenRequests).toHaveLength(0);
  });

  it("issuer changed, with no iss on the way back: discovering again refuses it before the exchange", async () => {
    // Many authorization servers neither send `iss` nor advertise it: then discovering again is the mix-up defence.
    fake.sendIss = false;
    const url = await start();
    fake.setIssuer("/as2");
    const back = await fake.authorize(url);
    expect(back.iss).toBeNull();
    expect(await finishSignIn({ state: back.state!, code: back.code! }, "p1", deps())).toMatchObject({ ok: false, reason: "issuer_changed", server: "cal", issuer: `${fake.base}/as2` });
    expect(fake.tokenRequests).toHaveLength(0);
  });

  it("a server that sends no iss signs in", async () => {
    fake.sendIss = false;
    const back = await fake.authorize(await start());
    expect(await finishSignIn({ state: back.state!, code: back.code! }, "p1", deps())).toEqual({ ok: true, server: "cal" });
  });

  it("an iss on the way back that isn't the flow's issuer is refused before the exchange (RFC 9207)", async () => {
    const back = await fake.authorize(await start());
    // The `iss` in the URL is never what is remembered: the server's own discovery still says the flow's issuer.
    expect(await finishSignIn({ state: back.state!, code: back.code!, iss: "https://evil.example" }, "p1", deps())).toMatchObject({
      ok: false,
      reason: "issuer_changed",
      server: "cal",
      issuer: fake.issuer,
    });
    expect(fake.tokenRequests).toHaveLength(0);
  });

  // Final review, F3: after an issuer_changed the server waits at the issuer found now, so the next card names it.
  describe("rememberNewIssuer", () => {
    const base: ServerState = {
      serverName: "cal",
      fingerprint: "fp",
      tools: [],
      instructions: "",
      hasResources: false,
      listedAt: null,
      status: "needs-auth",
      error: "needs additional permissions (scope: a b)",
      stale: false,
      failures: 0,
      attemptedAt: null,
      authIssuer: "https://old.example",
      authReason: "scope",
      authScope: "a b",
    };
    const run = async (states: ServerState[]) => {
      const marked: unknown[] = [];
      await rememberNewIssuer("p1", "cal", "https://new.example", {
        readStates: async () => states,
        markNeedsAuth: async (...args) => {
          marked.push(args);
        },
      });
      return marked;
    };

    it("keeps why the server waits and what it asked for, with the new issuer", async () => {
      expect(await run([base])).toEqual([["p1", "cal", "scope", "https://new.example", "a b"]]);
    });

    it("a server with no state, or one that failed, waits for a first sign-in there", async () => {
      expect(await run([])).toEqual([["p1", "cal", "first", "https://new.example", null]]);
      expect(await run([{ ...base, status: "failed" }])).toEqual([["p1", "cal", "first", "https://new.example", null]]);
    });

    it("a connected server is left as it is", async () => {
      expect(await run([{ ...base, status: "connected" }])).toEqual([]);
    });
  });

  it("second finish with a valid state but a spent code keeps the good tokens", async () => {
    const first = await fake.authorize(await start());
    expect(await finishSignIn({ state: first.state!, code: first.code!, iss: first.iss! }, "p1", deps())).toMatchObject({ ok: true });
    const good = (await stored())?.tokens;
    expect(good?.access_token).toBeTruthy();
    const second = new URL(await start());
    const r = await finishSignIn({ state: second.searchParams.get("state")!, code: first.code!, iss: first.iss! }, "p1", deps());
    expect(r).toEqual({ ok: false, reason: "exchange_failed", server: "cal" });
    expect((await stored())?.tokens).toEqual(good);
  });
});

describe("connecting with a token", () => {
  it("with no token, connecting needs a first sign-in and registers nothing", async () => {
    const err = await connect().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NeedsSignIn);
    expect(err).toMatchObject({ reason: "first", issuer: fake.issuer });
    expect(fake.registrations).toHaveLength(0);
  });

  it("an expired token refreshes when connecting", async () => {
    fake.expiresIn = 1;
    await signIn();
    const before = (await stored())?.tokens?.access_token;
    clock = new Date(NOW.getTime() + 2000);
    const c = await connect();
    expect((await c.listTools()).map((t) => t.name)).toEqual(["ping"]);
    await c.close();
    const after = (await stored())?.tokens;
    expect(after?.access_token).toBeTruthy();
    expect(after?.access_token).not.toBe(before);
    expect(fake.tokenRequests.at(-1)?.get("grant_type")).toBe("refresh_token");
  });

  it("invalid_grant on refresh needs a sign-in again", async () => {
    fake.expiresIn = 1;
    await signIn();
    clock = new Date(NOW.getTime() + 2000);
    fake.rejectRefresh = true;
    const err = await connect().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NeedsSignIn);
    expect(err).toMatchObject({ reason: "lapsed" });
    const row = await store.loadConnection("p1", "cal", fake.mcpUrl, null, entryFingerprint(entryNow()));
    expect(row).not.toBeNull();
    expect(row?.tokens).toBeNull();
  });

  it("insufficient scope asks for the union", async () => {
    setServer({ oauth: { scope: "a" } });
    await signIn();
    expect((await stored())?.tokens?.scope).toBe("a");
    fake.requiredScope = "b";
    const err = await connect().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NeedsSignIn);
    expect(err).toMatchObject({ reason: "scope", scope: "a b", issuer: fake.issuer });
  });

  it("the next «Conectar» asks for the scope it is given", async () => {
    setServer({ oauth: { scope: "a" } });
    const r = await startSignIn("p1", "cal", deps(), { scope: "a b" });
    if (!r.ok) throw new Error(r.error);
    expect(new URL(r.authorizationUrl).searchParams.get("scope")).toBe("a b");
  });
});

describe("an entry's oauth.authServerMetadataUrl", () => {
  const METADATA_PATH = "/custom/as-metadata.json";
  const wellKnownAsked = () => fake.requests.filter((p) => p.includes("/.well-known/oauth-authorization-server") || p.includes("/.well-known/openid-configuration"));

  beforeEach(() => {
    fake.metadataAt = METADATA_PATH;
    fake.addClient("own-client");
    setServer({ oauth: { clientId: "own-client", authServerMetadataUrl: `${fake.base}${METADATA_PATH}` } });
  });

  it("is the authorization server's metadata, and the well-known paths are never asked", async () => {
    expect(await signIn()).toEqual({ ok: true, server: "cal" });
    expect(fake.requests).toContain(METADATA_PATH);
    expect(wellKnownAsked()).toEqual([]);
    expect((await stored())?.tokens?.access_token).toMatch(/^at_/);
  });

  it("refreshing when connecting reads it too", async () => {
    fake.expiresIn = 1;
    await signIn();
    clock = new Date(NOW.getTime() + 2000);
    const c = await connect();
    await c.close();
    expect(fake.tokenRequests.at(-1)?.get("grant_type")).toBe("refresh_token");
    expect(wellKnownAsked()).toEqual([]);
  });

  it("the issuer is still what that metadata states, and a change is refused", async () => {
    fake.sendIss = false;
    const url = new URL(await start());
    expect(`${url.origin}${url.pathname}`).toBe(`${fake.issuer}/authorize`);
    fake.setIssuer("/as2");
    const back = await fake.authorize(url.toString());
    expect(await finishSignIn({ state: back.state!, code: back.code! }, "p1", deps())).toMatchObject({ ok: false, reason: "issuer_changed", server: "cal", issuer: `${fake.base}/as2` });
    expect(fake.tokenRequests).toHaveLength(0);
  });

  it("metadata that isn't there is unreachable", async () => {
    setServer({ oauth: { clientId: "own-client", authServerMetadataUrl: `${fake.base}/nowhere.json` } });
    expect(await startSignIn("p1", "cal", deps())).toMatchObject({ ok: false, reason: "unreachable" });
  });
});

describe("hostile or broken authorization server metadata", () => {
  const METADATA_PATH = "/custom/as-metadata.json";
  const flows = async () => (await pg.query(`SELECT 1 FROM "personMcpOAuthFlows"`)).rows.length;
  const jsonBody = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

  describe("at an entry's oauth.authServerMetadataUrl", () => {
    beforeEach(() => {
      fake.metadataAt = METADATA_PATH;
      fake.addClient("own-client");
      setServer({ oauth: { clientId: "own-client", authServerMetadataUrl: `${fake.base}${METADATA_PATH}` } });
    });

    const refusedWith = async (serve: (m: Record<string, unknown>) => Response, error: RegExp) => {
      fake.serveMetadata = serve;
      const r = await startSignIn("p1", "cal", deps());
      expect(r).toMatchObject({ ok: false, reason: "unreachable" });
      expect(r.ok ? "" : r.error).toMatch(error);
      expect(await flows()).toBe(0);
    };

    it("a javascript: authorization_endpoint is unreachable, and no URL comes back", async () => {
      await refusedWith((m) => jsonBody({ ...m, authorization_endpoint: "javascript:alert(document.domain)//" }), /authorization_endpoint is not an https URL/);
    });

    it("a data: or http: endpoint is refused too", async () => {
      await refusedWith((m) => jsonBody({ ...m, token_endpoint: "data:text/plain,x" }), /token_endpoint is not an https URL/);
      await refusedWith((m) => jsonBody({ ...m, registration_endpoint: "http://mcp.fake.test/register" }), /registration_endpoint is not an https URL/);
      await refusedWith((m) => jsonBody({ ...m, revocation_endpoint: "not a url" }), /revocation_endpoint is not an https URL/);
      await refusedWith((m) => jsonBody({ ...m, issuer: "http://mcp.fake.test/as1" }), /no https issuer/);
    });

    // The reviewer's probe: a document at the person's metadata URL (evil.example) that says its issuer is Google's, with its
    // own token and revocation endpoints. A person's connection is bound to an issuer; a document that names Google's must
    // be served by Google, or whoever hosts it is not the issuer it claims to be.
    it("🔴 an issuer on another origin than the metadata URL is refused: a document can't claim an issuer it isn't served from", async () => {
      await refusedWith(
        (m) => jsonBody({ ...m, issuer: "https://accounts.google.com", token_endpoint: "https://evil.example/token", revocation_endpoint: "https://evil.example/revoke" }),
        /issuer.*(same origin|origin).*authServerMetadataUrl/,
      );
      await refusedWith((m) => jsonBody({ ...m, issuer: "https://mcp.fake.test.evil.example/as1" }), /origin/);
      await refusedWith((m) => jsonBody({ ...m, issuer: "https://other.fake.test/as1" }), /origin/);
    });

    it("an issuer on the metadata URL's own origin is fine, whatever its path (the document is served by its issuer)", async () => {
      fake.serveMetadata = (m) => jsonBody({ ...m, issuer: `${fake.base}/tenant/9` });
      const r = await startSignIn("p1", "cal", deps());
      expect(r.ok).toBe(true);
    });

    it("bad JSON is refused", async () => {
      await refusedWith(() => new Response("{not json", { headers: { "content-type": "application/json" } }), /not JSON/);
      await refusedWith(() => jsonBody(["an", "array"]), /not an object/);
    });

    it("missing token_endpoint is refused", async () => {
      await refusedWith(({ token_endpoint: _gone, ...m }) => jsonBody(m), /token_endpoint is not an https URL/);
    });

    it("no code in response_types_supported is refused", async () => {
      await refusedWith((m) => jsonBody({ ...m, response_types_supported: ["token"] }), /code response type/);
    });

    it("lists that aren't lists of strings, and flags that aren't booleans, are refused", async () => {
      await refusedWith((m) => jsonBody({ ...m, grant_types_supported: "authorization_code" }), /grant_types_supported is not a list of strings/);
      await refusedWith((m) => jsonBody({ ...m, code_challenge_methods_supported: [1] }), /code_challenge_methods_supported is not a list of strings/);
      await refusedWith((m) => jsonBody({ ...m, client_id_metadata_document_supported: "yes" }), /client_id_metadata_document_supported is not true or false/);
    });

    it("a redirect is never followed", async () => {
      await refusedWith(() => new Response(null, { status: 302, headers: { location: `${fake.base}/.well-known/oauth-authorization-server/as1` } }), /HTTP 302/);
      expect(fake.requests.filter((p) => p.startsWith("/.well-known/oauth-authorization-server"))).toEqual([]);
    });

    it("an oversize body is refused", async () => {
      await refusedWith((m) => jsonBody({ ...m, padding: "x".repeat(70 * 1024) }), /too large/);
    });
  });

  describe("found by the SDK's discovery", () => {
    it("an http authorization_endpoint never comes back as the URL to open", async () => {
      fake.serveMetadata = (m) => jsonBody({ ...m, authorization_endpoint: "http://mcp.fake.test/as1/authorize" });
      expect(await startSignIn("p1", "cal", deps())).toEqual({ ok: false, reason: "unreachable", error: "the authorization endpoint is not https" });
      expect(await flows()).toBe(0);
    });

    it("a javascript: authorization_endpoint is unreachable", async () => {
      fake.serveMetadata = (m) => jsonBody({ ...m, authorization_endpoint: "javascript:alert(document.domain)//" });
      const r = await startSignIn("p1", "cal", deps());
      expect(r).toMatchObject({ ok: false, reason: "unreachable" });
      expect(JSON.stringify(r)).not.toContain('"authorizationUrl"');
      expect(await flows()).toBe(0);
    });
  });
});

// Mounting (spec local 2026-11-17-oauth-de-conectores-mcp, §5.4 steps 1 and 4; mount.ts): the whole road, with the real
// provider, the real store and the fake MCP server — what lands in the person's server state.
describe("mounting a server that signs in", () => {
  let states: ServerState[];

  const mountDeps = (open: MountDeps["open"] = openMcp): MountDeps => ({
    readConfig: async () => config,
    readStates: async () => states,
    async saveState(_personId, s) {
      states = [...states.filter((x) => x.serverName !== s.serverName), s];
    },
    async resolveCredentials() {
      return new Map();
    },
    open,
    fetch: fake.fetch,
    now: () => clock,
    oauth: deps(),
  });
  const state = () => states.find((s) => s.serverName === "cal");
  /** A connection that goes bad once it is open (the clock moves, the server changes its mind) and before the list. */
  const openThenBreak = (breakIt: () => void): MountDeps["open"] => async (target, opts) => {
    const c = await openMcp(target, opts);
    breakIt();
    return c;
  };

  beforeEach(() => {
    states = [];
  });

  it("🔴 a 401 with no token is needs-auth first, naming the issuer, and it isn't a failure", async () => {
    expect(await mountServer("p1", "cal", mountDeps())).toMatchObject({
      status: "needs-auth",
      authReason: "first",
      authIssuer: fake.issuer,
      authScope: null,
      error: "needs authentication",
      failures: 0,
      tools: [],
    });
    expect(fake.registrations).toHaveLength(0);
  });

  it("once signed in it connects, lists and clears the sign-in it asked for", async () => {
    await mountServer("p1", "cal", mountDeps());
    expect(state()?.status).toBe("needs-auth");
    await signIn();
    expect(await mountServer("p1", "cal", mountDeps())).toMatchObject({ status: "connected", error: null, authReason: null, authIssuer: null, authScope: null });
    expect(state()?.tools.map((t) => t.rawName)).toEqual(["ping"]);
  });

  it("🔴 the sign-in is the speaker's: another person mounting the same entry still needs to sign in", async () => {
    await signIn();
    expect(await mountServer("p2", "cal", mountDeps())).toMatchObject({ status: "needs-auth", authReason: "first" });
  });

  // Review fix, round 1 (the reviewer's second probe): a connection belongs to the entry the person signed in with. An edit
  // of the same URL that adds a client and a metadata URL of its own — claiming Google's issuer or not — is another entry.
  describe("an entry edited after the person signed in", () => {
    /** Every request that leaves, with what it carried: nothing may carry the person's tokens to a host the edit names. */
    const recording = () => {
      const sent: { url: string; authorization: string | null; body: string }[] = [];
      const recordingFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const req = input instanceof Request ? input : null;
        sent.push({
          url: String(req ? req.url : input),
          authorization: new Headers(init?.headers ?? req?.headers).get("authorization"),
          body: String(init?.body ?? ""),
        });
        return fake.fetch(input, init);
      }) as typeof fetch;
      return { sent, recordingFetch };
    };

    it("🔴 finds no tokens: a first sign-in, and the old tokens are neither sent nor refreshed", async () => {
      await signIn();
      const tokens = (await stored())!.tokens!;
      const refreshesBefore = fake.tokenRequests.length;
      setServer({ headers: { "X-Edited": "1" } });
      const { sent, recordingFetch } = recording();
      const d = { ...mountDeps(), fetch: recordingFetch, oauth: { ...deps(), fetch: recordingFetch } };
      expect(await mountServer("p1", "cal", d)).toMatchObject({ status: "needs-auth", authReason: "first" });
      expect(fake.tokenRequests).toHaveLength(refreshesBefore);
      expect(JSON.stringify(sent)).not.toContain(tokens.access_token);
      expect(JSON.stringify(sent)).not.toContain(tokens.refresh_token!);
    });

    it("🔴 an edit with a client and a metadata URL of its own never gets the tokens, wherever its endpoints are", async () => {
      fake.expiresIn = 1;
      await signIn();
      const tokens = (await stored())!.tokens!;
      clock = new Date(NOW.getTime() + 2000); // expired: a refresh would be the next thing to happen
      const refreshesBefore = fake.tokenRequests.length;
      setServer({ oauth: { clientId: "x", authServerMetadataUrl: "https://evil.example/meta" } });
      const { sent, recordingFetch } = recording();
      const d = { ...mountDeps(), fetch: recordingFetch, oauth: { ...deps(), fetch: recordingFetch } };
      expect((await mountServer("p1", "cal", d))?.status).not.toBe("connected");
      expect(fake.tokenRequests).toHaveLength(refreshesBefore);
      expect(JSON.stringify(sent)).not.toContain(tokens.access_token);
      expect(JSON.stringify(sent)).not.toContain(tokens.refresh_token!);
      expect(sent.filter((r) => r.url.includes("evil.example") && (r.authorization || r.body))).toEqual([]);
    });

    it("signing in again with the edited entry replaces the connection, and the old entry's tokens are gone", async () => {
      await signIn();
      const before = (await stored())!.tokens!;
      setServer({ headers: { "X-Edited": "1" } });
      expect(await stored()).toBeNull(); // the connection of the entry as it was is not the edited entry's
      expect(await signIn()).toEqual({ ok: true, server: "cal" });
      const after = (await stored())!.tokens!;
      expect(after.access_token).not.toBe(before.access_token);
    });
  });

  it("an expired token the server refuses to refresh is needs-auth lapsed, and keeps the list it had", async () => {
    fake.expiresIn = 1;
    await signIn();
    await mountServer("p1", "cal", mountDeps());
    expect(state()?.status).toBe("connected");
    clock = new Date(NOW.getTime() + 2000);
    fake.rejectRefresh = true;
    expect(await mountServer("p1", "cal", mountDeps())).toMatchObject({ status: "needs-auth", authReason: "lapsed", authIssuer: fake.issuer, error: "needs you to sign in again", failures: 0 });
    expect(state()?.tools.map((t) => t.rawName)).toEqual(["ping"]);
  });

  it("🔴 a token that stops working in the middle of the session (the list is asked for after connecting) is needs-auth lapsed", async () => {
    fake.expiresIn = 1;
    await signIn();
    const open = openThenBreak(() => {
      clock = new Date(NOW.getTime() + 2000);
      fake.rejectRefresh = true;
    });
    expect(await mountServer("p1", "cal", mountDeps(open))).toMatchObject({ status: "needs-auth", authReason: "lapsed", authIssuer: fake.issuer, failures: 0 });
  });

  it("🔴 a 403 insufficient_scope in the middle of the session asks for the union of what it had and what is wanted", async () => {
    setServer({ oauth: { scope: "a" } });
    await signIn();
    const open = openThenBreak(() => {
      fake.requiredScope = "b";
    });
    expect(await mountServer("p1", "cal", mountDeps(open))).toMatchObject({
      status: "needs-auth",
      authReason: "scope",
      authScope: "a b",
      authIssuer: fake.issuer,
      error: "needs additional permissions (scope: a b)",
      failures: 0,
    });
  });

  it("🔴 with OAuth off (no oauth deps) the same 401 is a failure, as before", async () => {
    const { oauth: _off, ...off } = mountDeps();
    expect(await mountServer("p1", "cal", off)).toMatchObject({ status: "failed", failures: 1, authReason: null, authIssuer: null });
  });
});

// Final review, F1 (spec local 2026-11-17-oauth-de-conectores-mcp, §5.1): the SDK runs its OAuth on EVERY 401 and falls
// back to the server's own origin as the issuer. A 401 is a sign-in only from a server that is OAuth's — an `oauth` block,
// a connection of the person's, or a Bearer challenge with real metadata behind it —; any other is a failure, exactly the
// one OAuth off gives, and a person with no OAuth server gets the very same declarations and context.
describe("a 401 that isn't a sign-in", () => {
  let states: ServerState[];

  beforeEach(() => {
    states = [];
  });

  const mountWith = (oauth: boolean): MountDeps => ({
    readConfig: async () => config,
    readStates: async () => states,
    async saveState(_personId, s) {
      states = [...states.filter((x) => x.serverName !== s.serverName), s];
    },
    async resolveCredentials(_personId, names) {
      return new Map(names.filter((n) => creds.has(n)).map((n) => [n, creds.get(n)!] as [string, string]));
    },
    open: openMcp,
    fetch: fake.fetch,
    now: () => clock,
    ...(oauth && { oauth: deps() }),
  });

  /** Mounts `cal` with OAuth on and then off, each from no state: both states and what a turn declares from each. */
  async function onAndOff() {
    states = [];
    const on = await mountServer("p1", "cal", mountWith(true));
    const statesOn = states;
    states = [];
    const off = await mountServer("p1", "cal", mountWith(false));
    const statesOff = states;
    const turn = (s: ServerState[]) => connectorsForTurn("p1", { readConfig: async () => config, readStates: async () => s, now: () => clock, env: {} });
    return { on, off, statesOn, turnOn: await turn(statesOn), turnOff: await turn(statesOff) };
  }

  const wellKnownAsked = () => fake.requests.filter((p) => p.startsWith("/.well-known/"));

  it("🔴 a server keyed by X-API-Key that refuses a wrong key is failed, word for word as with OAuth off: retried, no authenticate tool, the same declarations and context", async () => {
    setServer({ headers: { "X-API-Key": "${credential:CAL_KEY}" } });
    creds.set("CAL_KEY", "wrong");
    fake.apiKey = "right";
    fake.challenge = null;
    fake.wellKnown = false;
    const { on, off, statesOn, turnOn, turnOff } = await onAndOff();
    expect(on).toMatchObject({ status: "failed", failures: 1, authReason: null, authIssuer: null, authScope: null });
    expect(on?.error).toBeTruthy();
    expect(on?.error).toBe(off?.error);
    expect(JSON.stringify(turnOn.declarations)).toBe(JSON.stringify(turnOff.declarations));
    expect(turnOn.contextText).toBe(turnOff.contextText);
    expect(turnOn.needsAuth).toBeUndefined();
    expect([...turnOn.routes.keys()].filter((k) => k.endsWith("__authenticate"))).toEqual([]);
    // Retried as any failure is: once DeepSeek's delay has passed.
    const parsed = parseMcpConfig(config.text, { reservedServerNames: new Set() });
    if (!parsed.ok) throw new Error(parsed.error);
    const later = new Date(clock.getTime() + retryDelayMs(1));
    expect(serversToMount(statesOn, parsed.config, config.approved, later)).toEqual(["cal"]);
    // The SDK's OAuth stopped at its first question: nobody's well-known paths were asked.
    expect(wellKnownAsked()).toEqual([]);
  });

  it("the same server with the right key connects with OAuth on, as it always did", async () => {
    setServer({ headers: { "X-API-Key": "${credential:CAL_KEY}" } });
    creds.set("CAL_KEY", "right");
    fake.apiKey = "right";
    fake.challenge = null;
    expect(await mountServer("p1", "cal", mountWith(true))).toMatchObject({ status: "connected", error: null, authReason: null });
  });

  it("🔴 a Bearer 401 from a server that publishes no metadata anywhere is failed as with OAuth off, not a Connect card that leads nowhere", async () => {
    fake.wellKnown = false;
    const { on, off, turnOn, turnOff } = await onAndOff();
    expect(on).toMatchObject({ status: "failed", failures: 1, authReason: null, authIssuer: null });
    expect(on?.error).toBe(off?.error);
    expect(turnOn.contextText).toBe(turnOff.contextText);
    expect(turnOn.needsAuth).toBeUndefined();
  });

  it("🔴 a 401 that asks for no Bearer token is failed even where the host publishes metadata (spec §5.1)", async () => {
    fake.challenge = null;
    const { on, off, turnOn, turnOff } = await onAndOff();
    expect(on).toMatchObject({ status: "failed", failures: 1, authReason: null });
    expect(on?.error).toBe(off?.error);
    expect(turnOn.contextText).toBe(turnOff.contextText);
    expect(wellKnownAsked()).toEqual([]);
  });

  it("an `oauth` block makes that same 401 a sign-in: the person's file says the server signs in", async () => {
    fake.challenge = null;
    setServer({ oauth: {} });
    expect(await mountServer("p1", "cal", mountWith(true))).toMatchObject({ status: "needs-auth", authReason: "first", authIssuer: fake.issuer, failures: 0 });
  });

  it("a connection the person has for the entry makes it a sign-in too: their token stopped working", async () => {
    await signIn();
    fake.challenge = null;
    fake.expiresIn = 1;
    await signIn();
    clock = new Date(NOW.getTime() + 2000);
    fake.rejectRefresh = true;
    expect(await mountServer("p1", "cal", mountWith(true))).toMatchObject({ status: "needs-auth", authReason: "lapsed", authIssuer: fake.issuer });
  });
});
