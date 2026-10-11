// QUIÉN LLAMA AL SERVIDOR MCP. El token sale SIEMPRE de la cabecera validada;
// `clientInfo` del protocolo no está autenticado y nunca decide nada.
import type { AuthInfo } from "@modelcontextprotocol/server";
import type { McpScope } from "./config";
import { findActiveToken, isTokenShaped, normalizeScopes } from "./tokens";

export interface McpCaller {
  userId: string;
  tokenId: string;
  scopes: ReadonlySet<McpScope>;
  /** Acotado a UN proyecto, o null. */
  projectId: string | null;
}

export async function verifyMcpToken(_req: Request, bearer?: string): Promise<AuthInfo | undefined> {
  if (!bearer || !isTokenShaped(bearer)) return undefined;
  const t = await findActiveToken(bearer);
  if (!t) return undefined;
  return {
    token: bearer,
    clientId: t.clientId ?? `personal:${t.id}`,
    scopes: t.scopes,
    ...(t.expiresAt ? { expiresAt: Math.floor(t.expiresAt.getTime() / 1000) } : {}),
    extra: { userId: t.userId, tokenId: t.id, projectId: t.projectId },
  };
}

export function callerFrom(authInfo: AuthInfo | undefined): McpCaller | null {
  const extra = authInfo?.extra as { userId?: unknown; tokenId?: unknown; projectId?: unknown } | undefined;
  if (!authInfo || typeof extra?.userId !== "string" || typeof extra.tokenId !== "string") return null;
  return {
    userId: extra.userId,
    tokenId: extra.tokenId,
    scopes: new Set(normalizeScopes(authInfo.scopes)),
    projectId: typeof extra.projectId === "string" ? extra.projectId : null,
  };
}
