// @vitest-environment node
// Las conexiones contra la base LOCAL.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";
import { connectionActivity, createPersonalToken, listConnections, revokeConnection } from "./connections";
import { exchangeCode, refreshTokens } from "./oauth/issue";
import { findActiveToken, tokenHash, tokenName } from "./tokens";

const USER = "prueba-mcp-conexiones";
const OTHER = "prueba-mcp-conexiones-otro";
const PROJECT = "prueba-mcp-conexiones-proyecto";
const FOREIGN = "prueba-mcp-conexiones-ajeno";
const DCR = "olc_prueba_conexiones";
const CIMD = "https://cliente.example/oauth/metadata.json";
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const REDIRECT = "http://127.0.0.1:5555/cb";

/** Una conexión OAuth de verdad: petición aprobada → canje. */
async function connect(userId: string, clientId: string, over: { scopes?: string[]; projectId?: string | null } = {}) {
  const code = `code-${Math.random().toString(36).slice(2).padEnd(38, "0")}`;
  const scopes = over.scopes ?? ["projects:read", "publish"];
  await db.insert(schema.mcpOauthRequests).values({
    id: `req-${Math.random().toString(36).slice(2)}`, clientId, redirectUri: REDIRECT, codeChallenge: CHALLENGE,
    scopes, status: "approved", userId, grantedScopes: scopes, projectId: over.projectId ?? null,
    codeHash: tokenHash(code), codeExpiresAt: new Date(Date.now() + 60_000), expiresAt: new Date(Date.now() + 60_000),
  });
  const r = await exchangeCode({ code, clientId, redirectUri: REDIRECT, codeVerifier: VERIFIER });
  if (!r.ok) throw new Error("no canjeó");
  const t = await findActiveToken(r.tokens.access_token);
  return { ...r.tokens, familyId: t!.familyId! };
}

beforeAll(async () => {
  await exigirBaseLocal();
  await db.insert(schema.users).values([{ id: USER, email: `${USER}@ejemplo.invalido` }, { id: OTHER, email: `${OTHER}@ejemplo.invalido` }]).onConflictDoNothing();
  await db.insert(schema.projects).values([
    { id: PROJECT, userId: USER, title: "Café Luna", brief: "", data: { html: "<p>" } },
    { id: FOREIGN, userId: OTHER, title: "Ajeno", brief: "", data: { html: "<p>" } },
  ]).onConflictDoNothing();
  await db.insert(schema.mcpOauthClients).values([
    { id: DCR, kind: "dcr", name: "Cliente DCR", redirectUris: [REDIRECT] },
    { id: CIMD, kind: "cimd", name: "Cliente CIMD", redirectUris: [REDIRECT], fetchedAt: new Date() },
  ]).onConflictDoNothing();
});
beforeEach(() => vi.stubEnv("MCP_RESOURCE_URL", "https://mcp.openlen.com/mcp"));
afterAll(async () => {
  await db.delete(schema.mcpOauthClients).where(inArray(schema.mcpOauthClients.id, [DCR, CIMD]));
  await db.delete(schema.users).where(inArray(schema.users.id, [USER, OTHER]));
});

describe("las conexiones", () => {
  it("lista la familia OAuth con su cliente y el token personal, sin secretos ni huellas", async () => {
    const a = await connect(USER, CIMD, { projectId: PROJECT });
    const p = await createPersonalToken(USER, { name: "Mi portátil", scopes: ["projects:write"], projectId: null, expiresInDays: 30 });
    if (!p.ok) throw new Error("no creó");
    const list = await listConnections(USER);
    expect(list.find((c) => c.id === a.familyId)).toMatchObject({
      kind: "oauth", name: "Cliente CIMD", verified: true, clientHost: "cliente.example",
      scopes: ["projects:read", "publish"], projectId: PROJECT, projectTitle: "Café Luna",
    });
    expect(list.find((c) => c.id === p.id)).toMatchObject({ kind: "personal", name: "Mi portátil", scopes: ["projects:read", "projects:write"], projectId: null });
    const json = JSON.stringify(list);
    for (const secret of [p.secret, a.access_token, a.refresh_token, tokenHash(p.secret), tokenHash(a.access_token)]) expect(json).not.toContain(secret);
  });

  it("una familia refrescada sigue siendo UNA conexión; un cliente DCR sale sin verificar", async () => {
    const a = await connect(USER, DCR);
    await refreshTokens({ refreshToken: a.refresh_token, clientId: DCR });
    const mine = (await listConnections(USER)).filter((c) => c.id === a.familyId);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ verified: false, clientHost: null });
  });

  it("🔴 revocar la conexión: cae el acceso de la hora y el refresh (la familia entera)", async () => {
    const a = await connect(USER, DCR);
    expect(await revokeConnection(USER, a.familyId)).toBe(true);
    expect(await findActiveToken(a.access_token)).toBeNull();
    expect((await refreshTokens({ refreshToken: a.refresh_token, clientId: DCR })).ok).toBe(false);
    expect((await listConnections(USER)).some((c) => c.id === a.familyId)).toBe(false);
  });

  it("🔴 la conexión de otra persona: ni se revoca ni se ve su actividad", async () => {
    const theirs = await connect(OTHER, DCR);
    await db.insert(schema.mcpAudit).values({ userId: OTHER, tokenId: theirs.familyId, tool: "list_projects", ok: true, durationMs: 5 });
    expect(await revokeConnection(USER, theirs.familyId)).toBe(false);
    expect(await findActiveToken(theirs.access_token)).not.toBeNull();
    expect(await connectionActivity(USER, theirs.familyId)).toEqual([]);
  });

  it("la actividad: lo último primero; el último uso de una familia sale de ella", async () => {
    const a = await connect(USER, DCR);
    await db.insert(schema.mcpAudit).values([
      { userId: USER, tokenId: a.familyId, tool: "read_file", projectId: PROJECT, ok: true, durationMs: 12, createdAt: new Date(Date.now() - 60_000) },
      { userId: USER, tokenId: a.familyId, tool: "publish", projectId: PROJECT, ok: false, errorCode: "approval_required", durationMs: 30 },
    ]);
    const act = await connectionActivity(USER, a.familyId);
    expect(act.map((x) => x.tool)).toEqual(["publish", "read_file"]);
    expect(act[0]).toMatchObject({ ok: false, errorCode: "approval_required", projectId: PROJECT });
    expect((await listConnections(USER)).find((c) => c.id === a.familyId)?.lastUsedAt).toBeInstanceOf(Date);
  });

  it("crear un token personal: leer va siempre; un proyecto ajeno no; caducidades fijas", async () => {
    expect(await createPersonalToken(USER, { name: "x", scopes: [], projectId: FOREIGN, expiresInDays: null })).toEqual({ ok: false, error: "project_not_allowed" });
    expect(await createPersonalToken(USER, { name: "x", scopes: [], projectId: null, expiresInDays: 12 })).toEqual({ ok: false, error: "invalid_expiry" });
    expect(await createPersonalToken(USER, { name: "  ", scopes: [], projectId: null, expiresInDays: null })).toEqual({ ok: false, error: "invalid_name" });
    const r = await createPersonalToken(USER, { name: "CI", scopes: ["publish", "admin"], projectId: PROJECT, expiresInDays: 90 });
    expect(r.ok && r.secret).toMatch(/^olp_/);
    if (!r.ok) return;
    expect(await findActiveToken(r.secret)).toMatchObject({ kind: "personal", scopes: ["projects:read", "publish"], projectId: PROJECT });
    expect(await revokeConnection(USER, r.id)).toBe(true);
    expect(await findActiveToken(r.secret)).toBeNull();
  });

  it("el nombre de una familia sobrevive a que la limpieza borre sus accesos caducados", async () => {
    const a = await connect(USER, CIMD);
    await db.delete(schema.mcpTokens).where(eq(schema.mcpTokens.familyId, a.familyId));
    expect(await tokenName(a.familyId)).toBe("Cliente CIMD");
  });
});
