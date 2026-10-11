// LAS APROBACIONES: la herramienta las crea, la persona las decide en
// openlen.com con SU sesión, y el agente reintenta con el id. Ningún camino
// del MCP decide una aprobación: un agente con instrucciones inyectadas no se
// aprueba a sí mismo (la pata «canal público» de la trifecta, con puerta).
import crypto from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { siteOrigin } from "./config";

export type ApprovalAction = "publish" | "unpublish";

export interface ApprovalRequest {
  userId: string;
  tokenId: string;
  projectId: string;
  action: ApprovalAction;
  subdomain: string | null;
}

export type McpApprovalRow = typeof schema.mcpApprovals.$inferSelect;

export const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

export function approvalUrl(id: string): string {
  return `${siteOrigin()}/mcp/approve/${id}`;
}

export async function createApproval(req: ApprovalRequest, now: Date = new Date()): Promise<{ id: string; expiresAt: Date }> {
  const id = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + APPROVAL_TTL_MS);
  await db.insert(schema.mcpApprovals).values({ id, ...req, createdAt: now, expiresAt });
  return { id, expiresAt };
}

/** La aprobación, sólo si es de esta persona (si no, como si no existiera). */
export async function getApprovalForUser(id: string, userId: string): Promise<McpApprovalRow | null> {
  const [row] = await db
    .select()
    .from(schema.mcpApprovals)
    .where(and(eq(schema.mcpApprovals.id, id), eq(schema.mcpApprovals.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** Una vez, por su dueña, mientras no caduque. Un solo UPDATE condicional. */
export async function decideApproval(id: string, userId: string, decision: "approve" | "deny", now: Date = new Date()): Promise<boolean> {
  const rows = await db
    .update(schema.mcpApprovals)
    .set({ status: decision === "approve" ? "approved" : "denied", decidedAt: now })
    .where(
      and(
        eq(schema.mcpApprovals.id, id),
        eq(schema.mcpApprovals.userId, userId),
        eq(schema.mcpApprovals.status, "pending"),
        gt(schema.mcpApprovals.expiresAt, now),
      ),
    )
    .returning({ id: schema.mcpApprovals.id });
  return rows.length > 0;
}

export async function checkApproval(
  id: string,
  req: ApprovalRequest,
  now: Date = new Date(),
): Promise<"ok" | "pending" | "denied" | "expired" | "used" | "mismatch" | "not_found"> {
  const [row] = await db.select().from(schema.mcpApprovals).where(eq(schema.mcpApprovals.id, id)).limit(1);
  if (!row) return "not_found";
  const matches =
    row.userId === req.userId &&
    row.tokenId === req.tokenId &&
    row.projectId === req.projectId &&
    row.action === req.action &&
    (row.subdomain ?? null) === (req.subdomain ?? null);
  if (!matches) return "mismatch";
  if (row.status === "used") return "used";
  if (row.status === "denied") return "denied";
  if (row.expiresAt.getTime() <= now.getTime()) return "expired";
  return row.status === "approved" ? "ok" : "pending";
}

export async function markApprovalUsed(id: string): Promise<void> {
  await db
    .update(schema.mcpApprovals)
    .set({ status: "used", usedAt: new Date() })
    .where(and(eq(schema.mcpApprovals.id, id), eq(schema.mcpApprovals.status, "approved")));
}

/** Republicar en el MISMO subdominio desde la MISMA conexión, ya aprobado y usado antes. */
export async function hasTrustedPublish(req: ApprovalRequest): Promise<boolean> {
  if (req.action !== "publish" || !req.subdomain) return false;
  const [row] = await db
    .select({ id: schema.mcpApprovals.id })
    .from(schema.mcpApprovals)
    .where(
      and(
        eq(schema.mcpApprovals.userId, req.userId),
        eq(schema.mcpApprovals.tokenId, req.tokenId),
        eq(schema.mcpApprovals.projectId, req.projectId),
        eq(schema.mcpApprovals.action, "publish"),
        eq(schema.mcpApprovals.subdomain, req.subdomain),
        eq(schema.mcpApprovals.status, "used"),
      ),
    )
    .limit(1);
  return Boolean(row);
}
