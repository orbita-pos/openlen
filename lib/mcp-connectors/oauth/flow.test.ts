// @vitest-environment node
//
// Signing in to an MCP server with the SDK's OAuth, server-side (spec local 2026-11-17-oauth-de-conectores-mcp, §5.2–5.4,
// §10.1, §10.2, §10.6): `startSignIn` / `finishSignIn` and the connection provider, end to end against a fake MCP server
// with its own authorization server on 127.0.0.1, and the real store over PGlite.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";

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
const { finishSignIn, startSignIn } = await import("./flow");
const { connectionProvider, NeedsSignIn } = await import("./provider");
const { openMcp } = await import("../client");
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
const stored = () => store.loadConnection("p1", "cal", fake.mcpUrl, fake.issuer);

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

  it("a server with no authorization server is unreachable", async () => {
    setServer({ url: "https://mcp.fake.test/nowhere" });
    const d = { ...deps(), fetch: (async () => new Response("no", { status: 404 })) as typeof fetch };
    expect(await startSignIn("p1", "cal", d)).toMatchObject({ ok: false, reason: "unreachable" });
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

  it("issuer changed", async () => {
    const url = await start();
    fake.setIssuer("/as2");
    const back = await fake.authorize(url);
    expect(await finishSignIn({ state: back.state!, code: back.code!, iss: back.iss! }, "p1", deps())).toEqual({ ok: false, reason: "issuer_changed", server: "cal" });
    expect(fake.tokenRequests).toHaveLength(0);
  });

  it("an iss on the way back that isn't the flow's issuer is refused before the exchange (RFC 9207)", async () => {
    const back = await fake.authorize(await start());
    expect(await finishSignIn({ state: back.state!, code: back.code!, iss: "https://evil.example" }, "p1", deps())).toEqual({ ok: false, reason: "issuer_changed", server: "cal" });
    expect(fake.tokenRequests).toHaveLength(0);
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
    const row = await store.loadConnection("p1", "cal", fake.mcpUrl, null);
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
