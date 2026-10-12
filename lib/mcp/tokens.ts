// LOS TOKENS DEL SERVIDOR MCP. 32 bytes al azar → la huella SHA-256 sin sal
// basta (no hay diccionario que probar), como las llaves del teléfono
// (lib/movil/secreto.ts). El secreto se enseña UNA vez, al crearlo.
import crypto from "node:crypto";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { MCP_SCOPES, type McpScope } from "./config";

export const PERSONAL_TOKEN_PREFIX = "olp_";
export const OAUTH_TOKEN_PREFIX = "ola_";
const SHAPE = /^ol[pa]_[A-Za-z0-9_-]{43}$/;
/** `lastUsedAt` se apunta como mucho cada 5 minutos: no una escritura por llamada. */
const LAST_USED_EVERY_MS = 5 * 60_000;

export interface McpTokenRecord {
  id: string;
  userId: string;
  kind: "personal" | "oauth";
  name: string;
  scopes: McpScope[];
  projectId: string | null;
  clientId: string | null;
  /** La familia OAuth (la conexión), o null en los personales. */
  familyId: string | null;
  expiresAt: Date | null;
}

export function isTokenShaped(value: string): boolean {
  return SHAPE.test(value);
}

export function newTokenSecret(prefix: string): string {
  return prefix + crypto.randomBytes(32).toString("base64url");
}

export function tokenHash(secret: string): string {
  return crypto.createHash("sha256").update(secret, "utf8").digest("hex");
}

export function normalizeScopes(input: readonly string[]): McpScope[] {
  const pedidos = new Set(input);
  return MCP_SCOPES.filter((s) => pedidos.has(s));
}

export async function mintPersonalToken(p: {
  userId: string;
  name: string;
  scopes: readonly string[];
  projectId?: string | null;
  expiresAt?: Date | null;
}): Promise<{ id: string; secret: string }> {
  const secret = newTokenSecret(PERSONAL_TOKEN_PREFIX);
  const id = crypto.randomUUID();
  await db.insert(schema.mcpTokens).values({
    id,
    hash: tokenHash(secret),
    userId: p.userId,
    kind: "personal",
    name: p.name.slice(0, 100) || "Personal token",
    scopes: normalizeScopes(p.scopes),
    projectId: p.projectId ?? null,
    expiresAt: p.expiresAt ?? null,
  });
  return { id, secret };
}

function toRecord(row: typeof schema.mcpTokens.$inferSelect): McpTokenRecord {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind,
    name: row.name,
    scopes: normalizeScopes(row.scopes),
    projectId: row.projectId,
    clientId: row.clientId,
    familyId: row.familyId,
    expiresAt: row.expiresAt,
  };
}

/** El token vivo con ese secreto, o null (no existe, revocado o caducado). */
export async function findActiveToken(secret: string, now: Date = new Date()): Promise<McpTokenRecord | null> {
  if (!isTokenShaped(secret)) return null;
  const [row] = await db
    .select()
    .from(schema.mcpTokens)
    .where(and(eq(schema.mcpTokens.hash, tokenHash(secret)), isNull(schema.mcpTokens.revokedAt)))
    .limit(1);
  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return null;
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > LAST_USED_EVERY_MS) {
    await db.update(schema.mcpTokens).set({ lastUsedAt: now }).where(eq(schema.mcpTokens.id, row.id));
  }
  return toRecord(row);
}

export async function listTokens(userId: string): Promise<(McpTokenRecord & { createdAt: Date; lastUsedAt: Date | null })[]> {
  const rows = await db
    .select()
    .from(schema.mcpTokens)
    .where(and(eq(schema.mcpTokens.userId, userId), isNull(schema.mcpTokens.revokedAt)))
    .orderBy(desc(schema.mcpTokens.createdAt));
  return rows.map((r) => ({ ...toRecord(r), createdAt: r.createdAt, lastUsedAt: r.lastUsedAt }));
}

/** Revoca UNO de la persona. Devuelve si había algo que revocar. */
export async function revokeToken(userId: string, id: string): Promise<boolean> {
  const rows = await db
    .update(schema.mcpTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.mcpTokens.id, id), eq(schema.mcpTokens.userId, userId), isNull(schema.mcpTokens.revokedAt)))
    .returning({ id: schema.mcpTokens.id });
  return rows.length > 0;
}

/** El nombre de la conexión (lo enseña la aprobación): `id` es el de un token
 *  personal o la familia de uno OAuth, que es lo que guarda `McpCaller.tokenId`. */
export async function tokenName(id: string): Promise<string | null> {
  const [row] = await db
    .select({ name: schema.mcpTokens.name })
    .from(schema.mcpTokens)
    .where(or(eq(schema.mcpTokens.id, id), eq(schema.mcpTokens.familyId, id)))
    .limit(1);
  if (row) return row.name;
  // La limpieza borra los accesos caducados de una familia; su nombre sigue en el cliente de sus refrescos.
  const [family] = await db
    .select({ name: schema.mcpOauthClients.name })
    .from(schema.mcpRefreshTokens)
    .innerJoin(schema.mcpOauthClients, eq(schema.mcpOauthClients.id, schema.mcpRefreshTokens.clientId))
    .where(eq(schema.mcpRefreshTokens.familyId, id))
    .limit(1);
  return family?.name ?? null;
}
