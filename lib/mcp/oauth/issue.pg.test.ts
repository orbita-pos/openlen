// @vitest-environment node
// El canje y el refresh contra la base LOCAL.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";
import { findActiveToken, tokenHash } from "../tokens";
import { exchangeCode, REFRESH_GRACE_MS, refreshTokens } from "./issue";

const USER = "prueba-oauth-issue";
const CLIENT = "olc_prueba_issue";
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const REDIRECT = "http://127.0.0.1:5555/cb";

async function approvedCode(code: string, over: Partial<typeof schema.mcpOauthRequests.$inferInsert> = {}) {
  await db.insert(schema.mcpOauthRequests).values({
    id: `req-${Math.random().toString(36).slice(2)}`, clientId: CLIENT, redirectUri: REDIRECT, codeChallenge: CHALLENGE,
    scopes: ["projects:read", "publish"], status: "approved", userId: USER, grantedScopes: ["projects:read", "publish"],
    codeHash: tokenHash(code), codeExpiresAt: new Date(Date.now() + 60_000), expiresAt: new Date(Date.now() + 60_000), ...over,
  });
}

beforeAll(async () => {
  await exigirBaseLocal();
  await db.insert(schema.users).values({ id: USER, email: `${USER}@ejemplo.invalido` }).onConflictDoNothing();
  await db.insert(schema.mcpOauthClients).values({ id: CLIENT, kind: "dcr", name: "Cliente issue", redirectUris: [REDIRECT] }).onConflictDoNothing();
});
beforeEach(() => vi.stubEnv("MCP_RESOURCE_URL", "https://mcp.openlen.com/mcp"));
afterAll(async () => {
  await db.delete(schema.mcpOauthClients).where(eq(schema.mcpOauthClients.id, CLIENT));
  await db.delete(schema.users).where(eq(schema.users.id, USER));
});

describe("el canje del código", () => {
  it("con el verifier bueno da acceso (ola_, 1 h) y refresh (olr_); el acceso funciona en el MCP con la familia", async () => {
    await approvedCode("code-bueno-0000000000000000000000000000000");
    const r = await exchangeCode({ code: "code-bueno-0000000000000000000000000000000", clientId: CLIENT, redirectUri: REDIRECT, codeVerifier: VERIFIER });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tokens).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "projects:read publish" });
    expect(r.tokens.access_token).toMatch(/^ola_/);
    expect(r.tokens.refresh_token).toMatch(/^olr_/);
    const t = await findActiveToken(r.tokens.access_token);
    expect(t).toMatchObject({ userId: USER, kind: "oauth", clientId: CLIENT, scopes: ["projects:read", "publish"] });
    expect(t?.familyId).toBeTruthy();
  });

  it("🔴 un código vale una vez, con su verifier, su redirect y su cliente, y dentro de su plazo", async () => {
    await approvedCode("code-uno-00000000000000000000000000000000");
    const ok = { code: "code-uno-00000000000000000000000000000000", clientId: CLIENT, redirectUri: REDIRECT, codeVerifier: VERIFIER };
    expect((await exchangeCode({ ...ok, codeVerifier: "x".repeat(43) })).ok).toBe(false);
    expect((await exchangeCode({ ...ok, redirectUri: "http://127.0.0.1:5555/otra" })).ok).toBe(false);
    expect((await exchangeCode({ ...ok, clientId: "olc_otro" })).ok).toBe(false);
    expect((await exchangeCode(ok)).ok).toBe(true);
    expect(await exchangeCode(ok)).toEqual({ ok: false, error: "invalid_grant" });
    await approvedCode("code-viejo-000000000000000000000000000000", { codeExpiresAt: new Date(Date.now() - 1000) });
    expect((await exchangeCode({ ...ok, code: "code-viejo-000000000000000000000000000000" })).ok).toBe(false);
  });

  it("un resource que no es el nuestro: invalid_target", async () => {
    await approvedCode("code-res-00000000000000000000000000000000");
    const r = await exchangeCode({ code: "code-res-00000000000000000000000000000000", clientId: CLIENT, redirectUri: REDIRECT, codeVerifier: VERIFIER, resource: "https://otro.com/mcp" });
    expect(r).toEqual({ ok: false, error: "invalid_target" });
  });
});

describe("🔴 el refresh rotatorio con ventana de gracia", () => {
  async function fresh() {
    const code = `code-${Math.random().toString(36).slice(2).padEnd(38, "0")}`;
    await approvedCode(code);
    const r = await exchangeCode({ code, clientId: CLIENT, redirectUri: REDIRECT, codeVerifier: VERIFIER });
    if (!r.ok) throw new Error("no canjeó");
    return r.tokens;
  }

  it("rota: da otro par, de la misma familia", async () => {
    const a = await fresh();
    const b = await refreshTokens({ refreshToken: a.refresh_token, clientId: CLIENT });
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.tokens.refresh_token).not.toBe(a.refresh_token);
    const [ta, tb] = await Promise.all([findActiveToken(a.access_token), findActiveToken(b.tokens.access_token)]);
    expect(tb?.familyId).toBe(ta?.familyId);
  });

  it("dos procesos con el mismo refresh dentro de la ventana: los dos reciben tokens válidos", async () => {
    const a = await fresh();
    const [x, y] = await Promise.all([
      refreshTokens({ refreshToken: a.refresh_token, clientId: CLIENT }),
      refreshTokens({ refreshToken: a.refresh_token, clientId: CLIENT }),
    ]);
    expect(x.ok && y.ok).toBe(true);
  });

  it("reusar el viejo pasada la ventana revoca la familia entera", async () => {
    const a = await fresh();
    const b = await refreshTokens({ refreshToken: a.refresh_token, clientId: CLIENT });
    if (!b.ok) throw new Error("no rotó");
    const later = new Date(Date.now() + REFRESH_GRACE_MS + 5_000);
    expect(await refreshTokens({ refreshToken: a.refresh_token, clientId: CLIENT }, later)).toEqual({ ok: false, error: "invalid_grant" });
    expect(await refreshTokens({ refreshToken: b.tokens.refresh_token, clientId: CLIENT }, later)).toEqual({ ok: false, error: "invalid_grant" });
    expect(await findActiveToken(b.tokens.access_token)).toBeNull();
  });

  it("con otro client_id, o un refresh inventado: invalid_grant", async () => {
    const a = await fresh();
    expect(await refreshTokens({ refreshToken: a.refresh_token, clientId: "olc_otro" })).toEqual({ ok: false, error: "invalid_grant" });
    expect(await refreshTokens({ refreshToken: "olr_" + "x".repeat(43), clientId: CLIENT })).toEqual({ ok: false, error: "invalid_grant" });
  });
});

describe("revocar", () => {
  it("revocar el refresh tumba también el acceso de su familia", async () => {
    const { revokeByToken } = await import("./revoke");
    const code = `code-rv-${Math.random().toString(36).slice(2).padEnd(35, "0")}`;
    await approvedCode(code);
    const r = await exchangeCode({ code, clientId: CLIENT, redirectUri: REDIRECT, codeVerifier: VERIFIER });
    if (!r.ok) throw new Error("no canjeó");
    await revokeByToken(r.tokens.refresh_token);
    expect(await findActiveToken(r.tokens.access_token)).toBeNull();
    expect((await refreshTokens({ refreshToken: r.tokens.refresh_token, clientId: CLIENT })).ok).toBe(false);
  });
});
