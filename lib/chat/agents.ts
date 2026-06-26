// Team seats — platform users (chatAgents) granted Desk access to a project.
// Agents reply AS the business (ownerChatUserId); conversations stay 2-participant.
// v1: invite existing OpenLen users only (no magic-link invites for non-users).

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/** 'owner' if the user owns the project; 'agent' if they have an active chatAgents
 *  row; null if neither (unauthorized). */
export async function resolveProjectAccess(
  projectId: string,
  userId: string,
): Promise<"owner" | "agent" | null> {
  const projRows = await db
    .select({ userId: schema.projects.userId })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  if (!projRows[0]) return null;
  if (projRows[0].userId === userId) return "owner";

  const agentRows = await db
    .select({ id: schema.chatAgents.id })
    .from(schema.chatAgents)
    .where(
      and(
        eq(schema.chatAgents.projectId, projectId),
        eq(schema.chatAgents.userId, userId),
        eq(schema.chatAgents.status, "active"),
      ),
    )
    .limit(1);
  if (agentRows.length > 0) return "agent";
  return null;
}

/** Project IDs where this platform user is an active agent (for listInbox). */
export async function listAgentProjectIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ projectId: schema.chatAgents.projectId })
    .from(schema.chatAgents)
    .where(
      and(
        eq(schema.chatAgents.userId, userId),
        eq(schema.chatAgents.status, "active"),
      ),
    );
  return rows.map((r) => r.projectId);
}

/** Platform userIds of all active agents for a project (for the presence gate). */
export async function listAgentUserIds(projectId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: schema.chatAgents.userId })
    .from(schema.chatAgents)
    .where(
      and(
        eq(schema.chatAgents.projectId, projectId),
        eq(schema.chatAgents.status, "active"),
      ),
    );
  return rows.flatMap((r) => (r.userId ? [r.userId] : []));
}

/** Count ALL chatAgents rows for a project (invited + active) for cap enforcement. */
export async function countAgents(projectId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.chatAgents.id })
    .from(schema.chatAgents)
    .where(eq(schema.chatAgents.projectId, projectId));
  return rows.length;
}

/** All agent rows for a project (for the management UI). */
export async function listAgents(
  projectId: string,
): Promise<Array<{ id: string; invitedEmail: string; status: string; createdAt: Date }>> {
  const rows = await db
    .select({
      id: schema.chatAgents.id,
      invitedEmail: schema.chatAgents.invitedEmail,
      status: schema.chatAgents.status,
      createdAt: schema.chatAgents.createdAt,
    })
    .from(schema.chatAgents)
    .where(eq(schema.chatAgents.projectId, projectId));
  return rows;
}

/** Invite (or re-activate) an OpenLen user as an agent. v1 rejects non-users.
 *  Idempotent via onConflictDoUpdate on (projectId, invitedEmail). */
export async function inviteAgent(
  projectId: string,
  email: string,
): Promise<{ agent: { id: string; invitedEmail: string; status: string; createdAt: Date } } | { error: "no_account" } | { error: "self" }> {
  const normalized = normalizeEmail(email);

  // Look up the platform user by email
  const userRows = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, normalized))
    .limit(1);
  if (userRows.length === 0) return { error: "no_account" };
  const inviteeUserId = userRows[0].id;

  // Reject if the invitee IS the project owner
  const projRows = await db
    .select({ userId: schema.projects.userId })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  if (projRows[0]?.userId === inviteeUserId) return { error: "self" };

  const now = new Date();
  const rows = await db
    .insert(schema.chatAgents)
    .values({
      projectId,
      userId: inviteeUserId,
      invitedEmail: normalized,
      status: "active",
      acceptedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.chatAgents.projectId, schema.chatAgents.invitedEmail],
      set: { userId: inviteeUserId, status: "active", acceptedAt: now },
    })
    .returning({
      id: schema.chatAgents.id,
      invitedEmail: schema.chatAgents.invitedEmail,
      status: schema.chatAgents.status,
      createdAt: schema.chatAgents.createdAt,
    });

  return { agent: rows[0] };
}

/** Remove an agent by their chatAgents row id, scoped to the project. */
export async function removeAgent(projectId: string, agentId: string): Promise<boolean> {
  const rows = await db
    .delete(schema.chatAgents)
    .where(
      and(
        eq(schema.chatAgents.id, agentId),
        eq(schema.chatAgents.projectId, projectId),
      ),
    )
    .returning({ id: schema.chatAgents.id });
  return rows.length > 0;
}
