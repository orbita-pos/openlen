// LA LIMPIEZA DIARIA DEL MCP (openlen-mcp-cleanup.timer). Borra lo que ya no
// sirve a nadie y deja lo que aún protege algo:
// - peticiones de /authorize caducadas hace más de un día;
// - accesos OAuth caducados hace más de un día (la conexión vive en sus
//   refrescos; su nombre, en el cliente — tokenName lo busca ahí);
// - refrescos caducados, o revocados hace más de 30 días. Un refresco ROTADO
//   que no ha caducado se queda: es lo que delata a quien reusa uno viejo;
// - clientes OAuth sin ningún token ni petición y sin uso en 30 días (Claude
//   y Gemini CLI registran uno nuevo en cada conexión; los CIMD son caché);
// - la auditoría de más de 90 días.
// Los tokens personales no se borran: su nombre lo enseña la auditoría.
import { and, eq, isNotNull, lt, notExists, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

const DAY_MS = 86_400_000;

export interface CleanupResult {
  requests: number;
  accessTokens: number;
  refreshTokens: number;
  clients: number;
  audit: number;
}

export async function cleanupMcp(now: Date = new Date()): Promise<CleanupResult> {
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);
  const requests = await db
    .delete(schema.mcpOauthRequests)
    .where(lt(schema.mcpOauthRequests.expiresAt, ago(1)))
    .returning({ id: schema.mcpOauthRequests.id });
  const accessTokens = await db
    .delete(schema.mcpTokens)
    .where(and(eq(schema.mcpTokens.kind, "oauth"), isNotNull(schema.mcpTokens.expiresAt), lt(schema.mcpTokens.expiresAt, ago(1))))
    .returning({ id: schema.mcpTokens.id });
  const refreshTokens = await db
    .delete(schema.mcpRefreshTokens)
    .where(or(lt(schema.mcpRefreshTokens.expiresAt, now), lt(schema.mcpRefreshTokens.revokedAt, ago(30))))
    .returning({ id: schema.mcpRefreshTokens.id });
  const clients = await db
    .delete(schema.mcpOauthClients)
    .where(
      and(
        lt(sql`coalesce(${schema.mcpOauthClients.lastUsedAt}, ${schema.mcpOauthClients.createdAt})`, ago(30)),
        notExists(db.select({ one: sql`1` }).from(schema.mcpRefreshTokens).where(eq(schema.mcpRefreshTokens.clientId, schema.mcpOauthClients.id))),
        notExists(db.select({ one: sql`1` }).from(schema.mcpTokens).where(eq(schema.mcpTokens.clientId, schema.mcpOauthClients.id))),
        notExists(db.select({ one: sql`1` }).from(schema.mcpOauthRequests).where(eq(schema.mcpOauthRequests.clientId, schema.mcpOauthClients.id))),
      ),
    )
    .returning({ id: schema.mcpOauthClients.id });
  const audit = await db.delete(schema.mcpAudit).where(lt(schema.mcpAudit.createdAt, ago(90))).returning({ id: schema.mcpAudit.id });
  return { requests: requests.length, accessTokens: accessTokens.length, refreshTokens: refreshTokens.length, clients: clients.length, audit: audit.length };
}
