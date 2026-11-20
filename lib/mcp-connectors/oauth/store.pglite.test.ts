// @vitest-environment node
//
// Where a person's OAuth connection to a connector and its pending sign-in live (spec local
// 2026-11-17-oauth-de-conectores-mcp, §5.3, §5.4), encrypted at rest and against real Postgres (PGlite), with the
// tables as `scripts/mcp-connectors-migrate.ts` creates them.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";

process.env.NEXTAUTH_SECRET ??= "test-secret-for-oauth-store";

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
const { FLOW_TTL_MS, createFlow, dropConnection, dropTokens, listConnectedServers, loadConnection, saveClientInfo, saveTokens, takeFlow } = await import("./store");

const URL_A = "https://calendar.example/mcp";
const URL_B = "https://otro.example/mcp";
const ISSUER = "https://accounts.example";
const CLIENT = { client_id: "cid-123", client_secret: "csecret-xyz", redirect_uris: ["https://openlen.app/api/mcp-connectors/oauth/callback"] };
const TOKENS = { access_token: "at_super_secret", refresh_token: "rt_super_secret", token_type: "Bearer", expires_in: 3600 };
const NOW = new Date("2026-11-17T10:00:00Z");

let pg: PGlite;
beforeEach(async () => {
  pg = new PGlite();
  await pg.query(`CREATE TABLE "users" ("id" text PRIMARY KEY);`);
  await pg.query(`INSERT INTO "users" ("id") VALUES ('p1'), ('p2');`);
  for (const statement of CREATE_MCP_CONNECTORS) await pg.query(statement);
  base.db = drizzle(pg, { schema });
});

const flowInput = (over: Partial<Parameters<typeof createFlow>[0]> = {}) => ({
  personId: "p1",
  serverName: "cal",
  fingerprint: "fp1",
  issuer: ISSUER,
  codeVerifier: "verifier-secret-value",
  scope: "calendar.read",
  now: NOW,
  ...over,
});

describe("the connection", () => {
  it("tokens round-trip encrypted", async () => {
    await saveClientInfo("p1", "cal", URL_A, ISSUER, CLIENT);
    await saveTokens("p1", "cal", URL_A, ISSUER, TOKENS);
    const raw = await pg.query<{ clientInfo: string; tokens: string }>(`SELECT "clientInfo", "tokens" FROM "personMcpOAuth"`);
    expect(raw.rows[0]!.tokens).not.toContain("at_super_secret");
    expect(raw.rows[0]!.tokens).not.toContain("rt_super_secret");
    expect(raw.rows[0]!.tokens.startsWith("v1:")).toBe(true);
    expect(raw.rows[0]!.clientInfo).not.toContain("csecret-xyz");
    expect(raw.rows[0]!.clientInfo.startsWith("v1:")).toBe(true);
    expect(await loadConnection("p1", "cal", URL_A, ISSUER)).toEqual({ serverUrl: URL_A, issuer: ISSUER, clientInfo: CLIENT, tokens: TOKENS });
  });

  it("a connection with no tokens yet has tokens null", async () => {
    await saveClientInfo("p1", "cal", URL_A, ISSUER, CLIENT);
    expect(await loadConnection("p1", "cal", URL_A, ISSUER)).toEqual({ serverUrl: URL_A, issuer: ISSUER, clientInfo: CLIENT, tokens: null });
  });

  it("nothing saved reads as null", async () => {
    expect(await loadConnection("p1", "cal", URL_A, null)).toBeNull();
  });

  it("another url gets nothing", async () => {
    await saveClientInfo("p1", "cal", URL_A, ISSUER, CLIENT);
    await saveTokens("p1", "cal", URL_A, ISSUER, TOKENS);
    expect(await loadConnection("p1", "cal", URL_B, null)).toBeNull();
    expect(await loadConnection("p1", "cal", URL_B, ISSUER)).toBeNull();
  });

  it("another issuer gets nothing", async () => {
    await saveClientInfo("p1", "cal", URL_A, ISSUER, CLIENT);
    await saveTokens("p1", "cal", URL_A, ISSUER, TOKENS);
    expect(await loadConnection("p1", "cal", URL_A, "https://evil.example")).toBeNull();
  });

  it("without an issuer given, the stored one is accepted and reported", async () => {
    await saveClientInfo("p1", "cal", URL_A, ISSUER, CLIENT);
    expect((await loadConnection("p1", "cal", URL_A, null))?.issuer).toBe(ISSUER);
  });

  it("people and servers never mix", async () => {
    await saveClientInfo("p1", "cal", URL_A, ISSUER, CLIENT);
    await saveTokens("p1", "cal", URL_A, ISSUER, TOKENS);
    expect(await loadConnection("p2", "cal", URL_A, ISSUER)).toBeNull();
    expect(await loadConnection("p1", "other", URL_A, ISSUER)).toBeNull();
  });

  it("saving the client again for the same url and issuer keeps the tokens", async () => {
    await saveClientInfo("p1", "cal", URL_A, ISSUER, CLIENT);
    await saveTokens("p1", "cal", URL_A, ISSUER, TOKENS);
    await saveClientInfo("p1", "cal", URL_A, ISSUER, { ...CLIENT, client_secret: "rotated" });
    const c = await loadConnection("p1", "cal", URL_A, ISSUER);
    expect(c?.tokens).toEqual(TOKENS);
    expect(c?.clientInfo).toMatchObject({ client_secret: "rotated" });
  });

  it("saving the client for another url or issuer drops the old tokens, they belong to the old binding", async () => {
    await saveClientInfo("p1", "cal", URL_A, ISSUER, CLIENT);
    await saveTokens("p1", "cal", URL_A, ISSUER, TOKENS);
    await saveClientInfo("p1", "cal", URL_B, ISSUER, CLIENT);
    expect(await loadConnection("p1", "cal", URL_B, ISSUER)).toEqual({ serverUrl: URL_B, issuer: ISSUER, clientInfo: CLIENT, tokens: null });
    await saveTokens("p1", "cal", URL_B, ISSUER, TOKENS);
    await saveClientInfo("p1", "cal", URL_B, "https://other-issuer.example", CLIENT);
    expect((await loadConnection("p1", "cal", URL_B, null))?.tokens).toBeNull();
    expect(await pg.query(`SELECT 1 FROM "personMcpOAuth"`).then((r) => r.rows.length)).toBe(1);
  });

  it("tokens can only be saved into a connection at that url and issuer", async () => {
    await expect(saveTokens("p1", "cal", URL_A, ISSUER, TOKENS)).rejects.toThrow(/no OAuth connection/);
    await saveClientInfo("p1", "cal", URL_A, ISSUER, CLIENT);
    await expect(saveTokens("p1", "cal", URL_B, ISSUER, TOKENS)).rejects.toThrow(/no OAuth connection/);
    await expect(saveTokens("p1", "cal", URL_A, "https://evil.example", TOKENS)).rejects.toThrow(/no OAuth connection/);
    await expect(saveTokens("p2", "cal", URL_A, ISSUER, TOKENS)).rejects.toThrow(/no OAuth connection/);
    expect((await loadConnection("p1", "cal", URL_A, ISSUER))?.tokens).toBeNull();
  });

  it("saving tokens again replaces them", async () => {
    await saveClientInfo("p1", "cal", URL_A, ISSUER, CLIENT);
    await saveTokens("p1", "cal", URL_A, ISSUER, TOKENS);
    await saveTokens("p1", "cal", URL_A, ISSUER, { ...TOKENS, access_token: "at_new" });
    expect((await loadConnection("p1", "cal", URL_A, ISSUER))?.tokens).toMatchObject({ access_token: "at_new" });
  });

  it("dropTokens keeps the client and removes only the tokens", async () => {
    await saveClientInfo("p1", "cal", URL_A, ISSUER, CLIENT);
    await saveTokens("p1", "cal", URL_A, ISSUER, TOKENS);
    await dropTokens("p1", "cal");
    expect(await loadConnection("p1", "cal", URL_A, ISSUER)).toEqual({ serverUrl: URL_A, issuer: ISSUER, clientInfo: CLIENT, tokens: null });
  });

  it("dropConnection hands back what it deleted, to revoke it", async () => {
    await saveClientInfo("p1", "cal", URL_A, ISSUER, CLIENT);
    await saveTokens("p1", "cal", URL_A, ISSUER, TOKENS);
    expect(await dropConnection("p1", "cal")).toEqual({ serverUrl: URL_A, issuer: ISSUER, clientInfo: CLIENT, tokens: TOKENS });
    expect(await loadConnection("p1", "cal", URL_A, ISSUER)).toBeNull();
    expect(await dropConnection("p1", "cal")).toBeNull();
  });

  it("dropConnection never touches another person's row", async () => {
    await saveClientInfo("p1", "cal", URL_A, ISSUER, CLIENT);
    await saveClientInfo("p2", "cal", URL_A, ISSUER, CLIENT);
    await dropConnection("p1", "cal");
    expect(await loadConnection("p2", "cal", URL_A, ISSUER)).not.toBeNull();
  });

  it("tokens that no longer decrypt count as missing, the client stays", async () => {
    await saveClientInfo("p1", "cal", URL_A, ISSUER, CLIENT);
    await pg.query(`UPDATE "personMcpOAuth" SET "tokens" = 'v1:AAAA'`);
    expect(await loadConnection("p1", "cal", URL_A, ISSUER)).toEqual({ serverUrl: URL_A, issuer: ISSUER, clientInfo: CLIENT, tokens: null });
  });

  it("a client that no longer decrypts is no connection at all", async () => {
    await saveClientInfo("p1", "cal", URL_A, ISSUER, CLIENT);
    await pg.query(`UPDATE "personMcpOAuth" SET "clientInfo" = 'v1:AAAA'`);
    expect(await loadConnection("p1", "cal", URL_A, ISSUER)).toBeNull();
    expect(await dropConnection("p1", "cal")).toBeNull();
    expect(await pg.query(`SELECT 1 FROM "personMcpOAuth"`).then((r) => r.rows.length)).toBe(0);
  });

  it("🔴 only a connection that still has usable tokens is listed as connected: not a bare client, not a row whose client no longer decrypts", async () => {
    await saveClientInfo("p1", "signed-in", URL_A, ISSUER, CLIENT);
    await saveTokens("p1", "signed-in", URL_A, ISSUER, TOKENS);
    await saveClientInfo("p1", "only-client", URL_A, ISSUER, CLIENT);
    await saveClientInfo("p1", "broken-client", URL_A, ISSUER, CLIENT);
    await saveTokens("p1", "broken-client", URL_A, ISSUER, TOKENS);
    await pg.query(`UPDATE "personMcpOAuth" SET "clientInfo" = 'v1:AAAA' WHERE "serverName" = 'broken-client'`);
    await saveClientInfo("p1", "broken-tokens", URL_A, ISSUER, CLIENT);
    await pg.query(`UPDATE "personMcpOAuth" SET "tokens" = 'v1:AAAA' WHERE "serverName" = 'broken-tokens'`);
    await saveClientInfo("p2", "of-someone-else", URL_A, ISSUER, CLIENT);
    await saveTokens("p2", "of-someone-else", URL_A, ISSUER, TOKENS);
    expect([...(await listConnectedServers("p1"))]).toEqual(["signed-in"]);
  });

  it("removing the person removes their connections and flows", async () => {
    await saveClientInfo("p1", "cal", URL_A, ISSUER, CLIENT);
    await createFlow(flowInput());
    await pg.query(`DELETE FROM "users" WHERE "id" = 'p1'`);
    expect((await pg.query(`SELECT 1 FROM "personMcpOAuth"`)).rows).toHaveLength(0);
    expect((await pg.query(`SELECT 1 FROM "personMcpOAuthFlows"`)).rows).toHaveLength(0);
  });
});

describe("the pending sign-in", () => {
  it("state is 32 random bytes, base64url, and never repeats", async () => {
    const a = await createFlow(flowInput());
    const b = await createFlow(flowInput());
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a, "base64url")).toHaveLength(32);
    expect(a).not.toBe(b);
  });

  it("the verifier is encrypted at rest and the flow expires ten minutes after it was made", async () => {
    await createFlow(flowInput());
    const raw = await pg.query<{ codeVerifier: string; expiresAt: Date; usedAt: Date | null }>(`SELECT "codeVerifier", "expiresAt", "usedAt" FROM "personMcpOAuthFlows"`);
    expect(raw.rows[0]!.codeVerifier).not.toContain("verifier-secret-value");
    expect(raw.rows[0]!.codeVerifier.startsWith("v1:")).toBe(true);
    expect(raw.rows[0]!.expiresAt.getTime()).toBe(NOW.getTime() + FLOW_TTL_MS);
    expect(raw.rows[0]!.usedAt).toBeNull();
    expect(FLOW_TTL_MS).toBe(10 * 60 * 1000);
  });

  it("a flow is taken once", async () => {
    const state = await createFlow(flowInput());
    expect(await takeFlow(state, new Date(NOW.getTime() + 1000))).toEqual({
      personId: "p1",
      serverName: "cal",
      fingerprint: "fp1",
      issuer: ISSUER,
      codeVerifier: "verifier-secret-value",
      scope: "calendar.read",
    });
    expect(await takeFlow(state, new Date(NOW.getTime() + 2000))).toBe("used");
  });

  it("a flow without a scope keeps it null", async () => {
    const state = await createFlow(flowInput({ scope: null }));
    expect(await takeFlow(state, NOW)).toMatchObject({ scope: null });
  });

  it("a flow is still good right before its time is up", async () => {
    const state = await createFlow(flowInput());
    expect(await takeFlow(state, new Date(NOW.getTime() + FLOW_TTL_MS - 1))).toMatchObject({ personId: "p1" });
  });

  it("a flow expires after 10 minutes", async () => {
    const state = await createFlow(flowInput());
    expect(await takeFlow(state, new Date(NOW.getTime() + FLOW_TTL_MS + 1))).toBe("expired");
  });

  it("a flow is expired at the very minute it was due", async () => {
    const state = await createFlow(flowInput());
    expect(await takeFlow(state, new Date(NOW.getTime() + FLOW_TTL_MS))).toBe("expired");
  });

  it("an expired flow is spent: it cannot be retried, even with an earlier clock", async () => {
    const state = await createFlow(flowInput());
    expect(await takeFlow(state, new Date(NOW.getTime() + FLOW_TTL_MS + 1))).toBe("expired");
    expect(await takeFlow(state, NOW)).toBe("used");
    const raw = await pg.query<{ usedAt: Date | null }>(`SELECT "usedAt" FROM "personMcpOAuthFlows"`);
    expect(raw.rows[0]!.usedAt).not.toBeNull();
  });

  it("a state nobody made is unknown", async () => {
    expect(await takeFlow("nope", NOW)).toBe("unknown");
    expect(await takeFlow("", NOW)).toBe("unknown");
  });

  it("two takes at once, one wins", async () => {
    const state = await createFlow(flowInput());
    const got = await Promise.all([takeFlow(state, NOW), takeFlow(state, NOW)]);
    expect(got.filter((g) => typeof g === "object")).toHaveLength(1);
    expect(got.filter((g) => g === "used")).toHaveLength(1);
  });

  it("a verifier that no longer decrypts is no flow at all, and it is spent", async () => {
    const state = await createFlow(flowInput());
    await pg.query(`UPDATE "personMcpOAuthFlows" SET "codeVerifier" = 'v1:AAAA'`);
    expect(await takeFlow(state, NOW)).toBe("unknown");
    expect(await takeFlow(state, NOW)).toBe("used");
  });
});

describe("the server's auth state columns", () => {
  it("personMcpServerState gains authIssuer, authReason and authScope, nullable", async () => {
    await pg.query(`INSERT INTO "personMcpServerState" ("personId","serverName","fingerprint","status") VALUES ('p1','cal','f','needs-auth')`);
    const r = await pg.query<{ authIssuer: string | null; authReason: string | null; authScope: string | null }>(`SELECT "authIssuer","authReason","authScope" FROM "personMcpServerState"`);
    expect(r.rows[0]).toEqual({ authIssuer: null, authReason: null, authScope: null });
  });

  it("the migration is idempotent", async () => {
    for (const statement of CREATE_MCP_CONNECTORS) await pg.query(statement);
    for (const statement of CREATE_MCP_CONNECTORS) await pg.query(statement);
  });
});
