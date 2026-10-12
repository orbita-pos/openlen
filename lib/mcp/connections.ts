// LAS CONEXIONES DE UNA PERSONA, para «Aplicaciones conectadas». Una conexión
// OAuth es una FAMILIA: lo que sobrevive a cada refresco (sus refrescos vivos
// en mcpRefreshTokens; los accesos de cada hora los borra la limpieza). Un
// token personal es su propia conexión. El id de una conexión es el mismo que
// McpCaller.tokenId, así que su actividad sale de mcpAudit por ese id.
// Revocar tumba la conexión entera.
import { and, desc, eq, gt, inArray, isNull, max, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { accesoAlProyecto } from "@/lib/projects/acceso";
import type { McpScope } from "./config";
import { revokeFamily } from "./oauth/issue";
import { mintPersonalToken, normalizeScopes } from "./tokens";

export interface Connection {
  /** La familia OAuth o el id del token personal (= McpCaller.tokenId). */
  id: string;
  kind: "oauth" | "personal";
  name: string;
  /** OAuth con CIMD: su identidad la publica su dominio. Personal: la creó la persona. DCR: no. */
  verified: boolean;
  /** El host del documento CIMD, o null. */
  clientHost: string | null;
  scopes: McpScope[];
  projectId: string | null;
  projectTitle: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
}

export interface ConnectionActivity {
  tool: string;
  projectId: string | null;
  ok: boolean;
  errorCode: string | null;
  durationMs: number;
  createdAt: Date;
}

export const TOKEN_EXPIRY_DAYS = [30, 90, 365] as const;
const DAY_MS = 86_400_000;

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export async function listConnections(userId: string, now: Date = new Date()): Promise<Connection[]> {
  const refresh = await db
    .select({
      familyId: schema.mcpRefreshTokens.familyId,
      clientId: schema.mcpRefreshTokens.clientId,
      scopes: schema.mcpRefreshTokens.scopes,
      projectId: schema.mcpRefreshTokens.projectId,
      createdAt: schema.mcpRefreshTokens.createdAt,
      expiresAt: schema.mcpRefreshTokens.expiresAt,
    })
    .from(schema.mcpRefreshTokens)
    .where(and(eq(schema.mcpRefreshTokens.userId, userId), isNull(schema.mcpRefreshTokens.revokedAt), gt(schema.mcpRefreshTokens.expiresAt, now)))
    .orderBy(desc(schema.mcpRefreshTokens.createdAt));
  // Una entrada por familia: los permisos del refresco más nuevo y la fecha del más viejo que sigue vivo.
  const families = new Map<string, { clientId: string; scopes: string[]; projectId: string | null; createdAt: Date; expiresAt: Date }>();
  for (const r of refresh) {
    const f = families.get(r.familyId);
    if (!f) families.set(r.familyId, { clientId: r.clientId, scopes: r.scopes, projectId: r.projectId, createdAt: r.createdAt, expiresAt: r.expiresAt });
    else f.createdAt = r.createdAt;
  }
  const familyIds = [...families.keys()];
  const clientIds = [...new Set([...families.values()].map((f) => f.clientId))];
  const personal = await db
    .select()
    .from(schema.mcpTokens)
    .where(
      and(
        eq(schema.mcpTokens.userId, userId),
        eq(schema.mcpTokens.kind, "personal"),
        isNull(schema.mcpTokens.revokedAt),
        or(isNull(schema.mcpTokens.expiresAt), gt(schema.mcpTokens.expiresAt, now)),
      ),
    );
  const connectionIds = [...familyIds, ...personal.map((t) => t.id)];
  const [clients, used] = await Promise.all([
    clientIds.length
      ? db
          .select({ id: schema.mcpOauthClients.id, name: schema.mcpOauthClients.name, kind: schema.mcpOauthClients.kind })
          .from(schema.mcpOauthClients)
          .where(inArray(schema.mcpOauthClients.id, clientIds))
      : Promise.resolve([]),
    // El último uso, de la auditoría (se guarda 90 días; los accesos de cada hora no).
    connectionIds.length
      ? db
          .select({ tokenId: schema.mcpAudit.tokenId, at: max(schema.mcpAudit.createdAt) })
          .from(schema.mcpAudit)
          .where(and(eq(schema.mcpAudit.userId, userId), inArray(schema.mcpAudit.tokenId, connectionIds)))
          .groupBy(schema.mcpAudit.tokenId)
      : Promise.resolve([]),
  ]);
  const clientOf = new Map(clients.map((c) => [c.id, c]));
  const usedOf = new Map(used.map((u) => [u.tokenId, u.at]));
  const projectIds = [
    ...new Set([...[...families.values()].map((f) => f.projectId), ...personal.map((t) => t.projectId)].filter((x): x is string => !!x)),
  ];
  const projects = projectIds.length
    ? await db.select({ id: schema.projects.id, title: schema.projects.title }).from(schema.projects).where(inArray(schema.projects.id, projectIds))
    : [];
  const titleOf = new Map(projects.map((p) => [p.id, p.title]));
  const out: Connection[] = [
    ...[...families].map(([id, f]) => {
      const c = clientOf.get(f.clientId);
      return {
        id,
        kind: "oauth" as const,
        name: c?.name ?? "MCP client",
        verified: c?.kind === "cimd",
        clientHost: c?.kind === "cimd" ? hostOf(f.clientId) : null,
        scopes: normalizeScopes(f.scopes),
        projectId: f.projectId,
        projectTitle: f.projectId ? (titleOf.get(f.projectId) ?? null) : null,
        createdAt: f.createdAt,
        lastUsedAt: usedOf.get(id) ?? null,
        expiresAt: f.expiresAt,
      };
    }),
    ...personal.map((t) => ({
      id: t.id,
      kind: "personal" as const,
      name: t.name,
      verified: true,
      clientHost: null,
      scopes: normalizeScopes(t.scopes),
      projectId: t.projectId,
      projectTitle: t.projectId ? (titleOf.get(t.projectId) ?? null) : null,
      createdAt: t.createdAt,
      lastUsedAt: usedOf.get(t.id) ?? t.lastUsedAt,
      expiresAt: t.expiresAt,
    })),
  ];
  return out.sort((a, b) => (b.lastUsedAt ?? b.createdAt).getTime() - (a.lastUsedAt ?? a.createdAt).getTime());
}

export async function revokeConnection(userId: string, id: string): Promise<boolean> {
  const [family] = await db
    .select({ familyId: schema.mcpRefreshTokens.familyId })
    .from(schema.mcpRefreshTokens)
    .where(and(eq(schema.mcpRefreshTokens.familyId, id), eq(schema.mcpRefreshTokens.userId, userId)))
    .limit(1);
  if (family) {
    await revokeFamily(id);
    return true;
  }
  const rows = await db
    .update(schema.mcpTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.mcpTokens.id, id), eq(schema.mcpTokens.userId, userId), eq(schema.mcpTokens.kind, "personal"), isNull(schema.mcpTokens.revokedAt)))
    .returning({ id: schema.mcpTokens.id });
  return rows.length > 0;
}

export async function connectionActivity(userId: string, id: string, limit = 20): Promise<ConnectionActivity[]> {
  return db
    .select({
      tool: schema.mcpAudit.tool,
      projectId: schema.mcpAudit.projectId,
      ok: schema.mcpAudit.ok,
      errorCode: schema.mcpAudit.errorCode,
      durationMs: schema.mcpAudit.durationMs,
      createdAt: schema.mcpAudit.createdAt,
    })
    .from(schema.mcpAudit)
    .where(and(eq(schema.mcpAudit.userId, userId), eq(schema.mcpAudit.tokenId, id)))
    .orderBy(desc(schema.mcpAudit.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));
}

export async function createPersonalToken(
  userId: string,
  p: { name: string; scopes: readonly string[]; projectId: string | null; expiresInDays: number | null },
  now: Date = new Date(),
): Promise<{ ok: true; id: string; secret: string } | { ok: false; error: "invalid_name" | "invalid_expiry" | "project_not_allowed" }> {
  const name = p.name.trim();
  if (!name || name.length > 100) return { ok: false, error: "invalid_name" };
  if (p.expiresInDays !== null && !(TOKEN_EXPIRY_DAYS as readonly number[]).includes(p.expiresInDays)) return { ok: false, error: "invalid_expiry" };
  if (p.projectId && !(await accesoAlProyecto(p.projectId, userId))) return { ok: false, error: "project_not_allowed" };
  const { id, secret } = await mintPersonalToken({
    userId,
    name,
    scopes: ["projects:read", ...p.scopes],
    projectId: p.projectId,
    expiresAt: p.expiresInDays === null ? null : new Date(now.getTime() + p.expiresInDays * DAY_MS),
  });
  return { ok: true, id, secret };
}
