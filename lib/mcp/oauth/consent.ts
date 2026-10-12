// EL CONSENTIMIENTO: la persona, con su sesión, aprueba o niega una petición
// pendiente. Aprobar da un código de 32 bytes (5 min, un solo uso, guardado
// por su huella) y la vuelta al cliente con `state` e `iss`.
import crypto from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { accesoAlProyecto } from "@/lib/projects/acceso";
import { normalizeScopes, tokenHash } from "../tokens";
import { withIss } from "./authorize";

export const CODE_TTL_MS = 5 * 60_000;
export type McpOauthRequestRow = typeof schema.mcpOauthRequests.$inferSelect;

export async function getPendingRequest(id: string): Promise<(McpOauthRequestRow & { clientName: string }) | null> {
  const [row] = await db
    .select({ request: schema.mcpOauthRequests, clientName: schema.mcpOauthClients.name })
    .from(schema.mcpOauthRequests)
    .innerJoin(schema.mcpOauthClients, eq(schema.mcpOauthClients.id, schema.mcpOauthRequests.clientId))
    .where(eq(schema.mcpOauthRequests.id, id))
    .limit(1);
  return row ? { ...row.request, clientName: row.clientName } : null;
}

export async function decideConsent(p: {
  requestId: string;
  userId: string;
  approve: boolean;
  scopes: readonly string[];
  projectId: string | null;
}): Promise<{ ok: true; redirect: string } | { ok: false; error: "not_found" | "expired" | "already_decided" | "project_not_allowed" }> {
  const [row] = await db.select().from(schema.mcpOauthRequests).where(eq(schema.mcpOauthRequests.id, p.requestId)).limit(1);
  if (!row) return { ok: false, error: "not_found" };
  if (row.status !== "pending") return { ok: false, error: "already_decided" };
  const now = new Date();
  if (row.expiresAt.getTime() <= now.getTime()) return { ok: false, error: "expired" };
  if (p.projectId && !(await accesoAlProyecto(p.projectId, p.userId))) return { ok: false, error: "project_not_allowed" };
  const state = row.state ?? undefined;
  // La condición va también en el UPDATE: dos clics a la vez dan un solo código.
  const pending = and(eq(schema.mcpOauthRequests.id, row.id), eq(schema.mcpOauthRequests.status, "pending"), gt(schema.mcpOauthRequests.expiresAt, now));
  if (!p.approve) {
    const done = await db.update(schema.mcpOauthRequests).set({ status: "denied", userId: p.userId }).where(pending).returning({ id: schema.mcpOauthRequests.id });
    if (done.length === 0) return { ok: false, error: "already_decided" };
    return { ok: true, redirect: withIss(row.redirectUri, { error: "access_denied", error_description: "The user denied the request.", state }) };
  }
  const asked = new Set(row.scopes);
  const granted = normalizeScopes(["projects:read", ...p.scopes]).filter((s) => asked.has(s) || s === "projects:read");
  const code = crypto.randomBytes(32).toString("base64url");
  const done = await db
    .update(schema.mcpOauthRequests)
    .set({ status: "approved", userId: p.userId, grantedScopes: granted, projectId: p.projectId, codeHash: tokenHash(code), codeExpiresAt: new Date(now.getTime() + CODE_TTL_MS) })
    .where(pending)
    .returning({ id: schema.mcpOauthRequests.id });
  if (done.length === 0) return { ok: false, error: "already_decided" };
  return { ok: true, redirect: withIss(row.redirectUri, { code, state }) };
}
