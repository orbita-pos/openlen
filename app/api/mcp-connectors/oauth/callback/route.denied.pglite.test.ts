// @vitest-environment node
//
// The way back when the person says no at the provider (spec local 2026-11-17-oauth-de-conectores-mcp, §5.4 step 3,
// §10.1), against the REAL flow and the REAL tables (PGlite): the page says «not connected», the `state` is spent, no
// code is ever exchanged and nothing is mounted, and the server is left exactly as it was — `needs-auth`, its attempt
// budget untouched. (route.test.ts mocks the flow away, so it can't see any of this.)
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";

process.env.NEXTAUTH_SECRET ??= "test-secret-for-oauth-callback";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

const base = vi.hoisted(() => ({ db: null as unknown, mounted: [] as string[], fetched: [] as string[] }));
vi.mock("@/lib/db", async () => {
  const s = await import("@/lib/db/schema");
  return {
    schema: s,
    get db() {
      return base.db;
    },
  };
});
vi.mock("@/lib/mcp-connectors/mount", () => ({
  mountServer: async (_p: string, name: string) => {
    base.mounted.push(name);
    return null;
  },
}));
vi.mock("@/lib/mcp-connectors/real", async () => {
  const oauthStore = await import("@/lib/mcp-connectors/oauth/store");
  return {
    realOAuthDeps: () => ({
      store: oauthStore,
      fetch: (async (input: RequestInfo | URL) => {
        base.fetched.push(String(input));
        throw new Error("no network in this test");
      }) as typeof fetch,
      siteUrl: "https://openlen.test",
      resolveCredentials: async () => new Map<string, string>(),
      now: () => new Date("2026-11-17T10:00:00Z"),
    }),
    realMountDeps: () => ({}),
  };
});

const { CREATE_MCP_CONNECTORS } = await import("@/scripts/mcp-connectors-migrate-sql");
const { auth } = await import("@/auth");
const { entryFingerprint, parseMcpConfig } = await import("@/lib/mcp-connectors/config");
const { createFlow, takeFlow } = await import("@/lib/mcp-connectors/oauth/store");
const { readServerStates, saveServerState, writeMcpConfig } = await import("@/lib/mcp-connectors/store");
const { GET } = await import("./route");

const NOW = new Date("2026-11-17T10:00:00Z");
const TEXT = JSON.stringify({ servers: { cal: { transport: "streamable-http", url: "https://calendarmcp.googleapis.com/mcp/v1", oauth: { scope: "https://www.googleapis.com/auth/calendar" } } } });
const parsed = parseMcpConfig(TEXT, { reservedServerNames: new Set() });
if (!parsed.ok) throw new Error(parsed.error);
const FP = entryFingerprint(parsed.config.servers.cal!);
const ISSUER = "https://accounts.google.com";

beforeEach(async () => {
  base.mounted.length = 0;
  base.fetched.length = 0;
  const pg = new PGlite();
  await pg.query(`CREATE TABLE "users" ("id" text PRIMARY KEY);`);
  await pg.query(`INSERT INTO "users" ("id") VALUES ('u1'), ('u2');`);
  for (const statement of CREATE_MCP_CONNECTORS) await pg.query(statement);
  base.db = drizzle(pg, { schema });
  vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({ user: { id: "u1" } });
  await writeMcpConfig("u1", TEXT, 0, { cal: FP }, ["cal"]);
  await saveServerState("u1", {
    serverName: "cal",
    fingerprint: FP,
    tools: [],
    instructions: "",
    hasResources: false,
    listedAt: null,
    status: "needs-auth",
    error: "needs authentication",
    stale: false,
    failures: 2,
    attemptedAt: NOW,
    authIssuer: ISSUER,
    authReason: "first",
    authScope: null,
  });
});

const start = () => createFlow({ personId: "u1", serverName: "cal", fingerprint: FP, issuer: ISSUER, codeVerifier: "verifier-secret-value", scope: null, now: NOW });
const back = (query: string) =>
  GET(new Request(`https://openlen.test/api/mcp-connectors/oauth/callback?${query}`, { headers: { cookie: "NEXT_LOCALE=es" } }));

describe("GET /api/mcp-connectors/oauth/callback, when the person says no", () => {
  it("🔴 says «not connected», spends the state, exchanges and mounts nothing, and leaves the server in needs-auth with its failures", async () => {
    const state = await start();
    const res = await back(`state=${state}&error=access_denied`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("No se conectó");
    expect(html).toContain('"ok":false');
    expect(html).toContain('"reason":"denied"');
    expect(html).toContain('"server":"cal"');

    // The real rows: the state is spent (a replay finds it used), nothing was asked of the network or mounted.
    expect(await takeFlow(state, NOW)).toBe("used");
    expect(base.fetched).toEqual([]);
    expect(base.mounted).toEqual([]);
    const [row] = await readServerStates("u1");
    expect(row).toMatchObject({ serverName: "cal", status: "needs-auth", failures: 2, authReason: "first", authIssuer: ISSUER });
  });

  // Final review, F5: a web sign-in comes back only to its person's browser; another session is refused before anything.
  it("a denial under another person's session is refused as the wrong browser, and touches nothing either", async () => {
    const state = await start();
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({ user: { id: "u2" } });
    const res = await back(`state=${state}&error=access_denied`);
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('"reason":"wrong_browser"');
    const [row] = await readServerStates("u1");
    expect(row).toMatchObject({ status: "needs-auth", failures: 2 });
    expect(base.mounted).toEqual([]);
  });
});
