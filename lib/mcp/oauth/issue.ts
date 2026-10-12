// EMITIR TOKENS: el canje del código (un solo uso, UPDATE condicional) y el
// refresh rotatorio por familia. La ventana de gracia es para los clientes con
// varios procesos que refrescan a la vez (Codex, Gemini CLI, OpenCode tienen
// carreras documentadas): dentro de ella, reusar el refresh anterior da otro
// par válido; fuera, es una reutilización sospechosa y cae la familia entera.
import crypto from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { mcpResourceUrl } from "../config";
import { newTokenSecret, normalizeScopes, OAUTH_TOKEN_PREFIX, tokenHash } from "../tokens";
import { verifyS256 } from "./pkce";

export const ACCESS_TTL_MS = 60 * 60_000;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000;
export const REFRESH_GRACE_MS = 120_000;
export const REFRESH_PREFIX = "olr_";

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

async function mintPair(
  p: { userId: string; clientId: string; scopes: string[]; projectId: string | null; familyId: string },
  now: Date,
): Promise<TokenResponse> {
  const [client] = await db
    .select({ name: schema.mcpOauthClients.name })
    .from(schema.mcpOauthClients)
    .where(eq(schema.mcpOauthClients.id, p.clientId))
    .limit(1);
  const access = newTokenSecret(OAUTH_TOKEN_PREFIX);
  const refresh = newTokenSecret(REFRESH_PREFIX);
  await db.insert(schema.mcpTokens).values({
    id: crypto.randomUUID(),
    hash: tokenHash(access),
    userId: p.userId,
    kind: "oauth",
    name: client?.name ?? "MCP client",
    scopes: p.scopes,
    projectId: p.projectId,
    clientId: p.clientId,
    familyId: p.familyId,
    expiresAt: new Date(now.getTime() + ACCESS_TTL_MS),
  });
  await db.insert(schema.mcpRefreshTokens).values({
    id: crypto.randomUUID(),
    hash: tokenHash(refresh),
    familyId: p.familyId,
    userId: p.userId,
    clientId: p.clientId,
    scopes: p.scopes,
    projectId: p.projectId,
    expiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
  });
  await db.update(schema.mcpOauthClients).set({ lastUsedAt: now }).where(eq(schema.mcpOauthClients.id, p.clientId));
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_MS / 1000, refresh_token: refresh, scope: p.scopes.join(" ") };
}

export async function exchangeCode(
  p: { code: string; clientId: string; redirectUri: string; codeVerifier: string; resource?: string | null },
  now: Date = new Date(),
): Promise<{ ok: true; tokens: TokenResponse } | { ok: false; error: "invalid_grant" | "invalid_target" }> {
  if (p.resource && p.resource.replace(/\/$/, "") !== mcpResourceUrl().replace(/\/$/, "")) return { ok: false, error: "invalid_target" };
  const [row] = await db.select().from(schema.mcpOauthRequests).where(eq(schema.mcpOauthRequests.codeHash, tokenHash(p.code))).limit(1);
  if (!row || row.status !== "approved" || !row.userId || !row.codeExpiresAt || row.codeExpiresAt.getTime() <= now.getTime()) {
    return { ok: false, error: "invalid_grant" };
  }
  if (row.clientId !== p.clientId || row.redirectUri !== p.redirectUri || !verifyS256(p.codeVerifier, row.codeChallenge)) {
    return { ok: false, error: "invalid_grant" };
  }
  // Un solo uso: quien gane este UPDATE canjea; el resto, invalid_grant.
  const used = await db
    .update(schema.mcpOauthRequests)
    .set({ status: "used" })
    .where(and(eq(schema.mcpOauthRequests.id, row.id), eq(schema.mcpOauthRequests.status, "approved")))
    .returning({ id: schema.mcpOauthRequests.id });
  if (used.length === 0) return { ok: false, error: "invalid_grant" };
  const tokens = await mintPair(
    { userId: row.userId, clientId: row.clientId, scopes: normalizeScopes(row.grantedScopes ?? []), projectId: row.projectId, familyId: crypto.randomUUID() },
    now,
  );
  return { ok: true, tokens };
}

export async function revokeFamily(familyId: string): Promise<void> {
  const now = new Date();
  await db
    .update(schema.mcpRefreshTokens)
    .set({ revokedAt: now })
    .where(and(eq(schema.mcpRefreshTokens.familyId, familyId), isNull(schema.mcpRefreshTokens.revokedAt)));
  await db.update(schema.mcpTokens).set({ revokedAt: now }).where(and(eq(schema.mcpTokens.familyId, familyId), isNull(schema.mcpTokens.revokedAt)));
}

export async function refreshTokens(
  p: { refreshToken: string; clientId: string },
  now: Date = new Date(),
): Promise<{ ok: true; tokens: TokenResponse } | { ok: false; error: "invalid_grant" }> {
  if (!p.refreshToken.startsWith(REFRESH_PREFIX)) return { ok: false, error: "invalid_grant" };
  const [row] = await db.select().from(schema.mcpRefreshTokens).where(eq(schema.mcpRefreshTokens.hash, tokenHash(p.refreshToken))).limit(1);
  if (!row || row.revokedAt || row.expiresAt.getTime() <= now.getTime() || row.clientId !== p.clientId) return { ok: false, error: "invalid_grant" };
  if (row.rotatedAt && now.getTime() - row.rotatedAt.getTime() > REFRESH_GRACE_MS) {
    // Reutilización fuera de la ventana: alguien tiene un refresh que ya no
    // debería tener. Cae la conexión entera.
    await revokeFamily(row.familyId);
    return { ok: false, error: "invalid_grant" };
  }
  if (!row.rotatedAt) {
    await db
      .update(schema.mcpRefreshTokens)
      .set({ rotatedAt: now })
      .where(and(eq(schema.mcpRefreshTokens.id, row.id), isNull(schema.mcpRefreshTokens.rotatedAt)));
  }
  const tokens = await mintPair(
    { userId: row.userId, clientId: row.clientId, scopes: normalizeScopes(row.scopes), projectId: row.projectId, familyId: row.familyId },
    now,
  );
  return { ok: true, tokens };
}
