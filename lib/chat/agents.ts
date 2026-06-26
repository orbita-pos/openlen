// Team seats — platform users (chatAgents) granted Desk access to a project.
// Agents reply AS the business (ownerChatUserId); conversations stay 2-participant.
// v1: existing-user → instant active; non-user → invited row + magic-link email.

import crypto from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — invitee may need to sign up

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** Issue a magic-link invite token. Raw token goes in the email; only sha256
 *  is stored. Returns the raw token. */
export async function issueAgentInviteToken(
  projectId: string,
  email: string,
): Promise<string> {
  const rawToken = crypto.randomBytes(32).toString("base64url");
  await db.insert(schema.chatAgentInviteTokens).values({
    tokenHash: sha256Hex(rawToken),
    projectId,
    email: email.toLowerCase().trim(),
    expires: new Date(Date.now() + INVITE_TTL_MS),
    used: false,
  });
  return rawToken;
}

/** Single-use atomic consume. Returns {projectId, email} or null if
 *  invalid / already used / expired / email mismatch.
 *  The email is folded into the atomic WHERE so a wrong-account attempt
 *  matches 0 rows and leaves used=false — the token is NOT burned. */
export async function consumeAgentInviteToken(
  rawToken: string,
  email: string,
): Promise<{ projectId: string; email: string } | null> {
  const rows = await db
    .update(schema.chatAgentInviteTokens)
    .set({ used: true })
    .where(
      and(
        eq(schema.chatAgentInviteTokens.tokenHash, sha256Hex(rawToken)),
        eq(schema.chatAgentInviteTokens.email, email.trim().toLowerCase()),
        eq(schema.chatAgentInviteTokens.used, false),
        gt(schema.chatAgentInviteTokens.expires, new Date()),
      ),
    )
    .returning({
      projectId: schema.chatAgentInviteTokens.projectId,
      email: schema.chatAgentInviteTokens.email,
    });
  if (rows.length === 0) return null;

  // Opportunistic cleanup of expired tokens, best-effort.
  void db
    .delete(schema.chatAgentInviteTokens)
    .where(
      and(
        eq(schema.chatAgentInviteTokens.projectId, rows[0].projectId),
        lt(schema.chatAgentInviteTokens.expires, new Date()),
      ),
    )
    .catch(() => {});

  return rows[0];
}

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

/** Invite an OpenLen user or a non-registered email as an agent.
 *  - Existing user → instant active (same-session path, unchanged).
 *  - Non-user → upsert invited row (userId null) + issue token → caller sends email.
 *  Idempotent via onConflict on (projectId, invitedEmail). */
export async function inviteAgent(
  projectId: string,
  email: string,
): Promise<
  | { agent: { id: string; invitedEmail: string; status: string; createdAt: Date } }
  | { agent: { id: string; invitedEmail: string; status: string; createdAt: Date }; invited: true; token: string }
  | { error: "self" }
> {
  const normalized = normalizeEmail(email);

  // Look up the platform user by email
  const userRows = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, normalized))
    .limit(1);

  // Reject self-invite (applies to existing users only — non-users can't be self)
  const projRows = await db
    .select({ userId: schema.projects.userId })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);

  if (userRows.length > 0) {
    const inviteeUserId = userRows[0].id;
    if (projRows[0]?.userId === inviteeUserId) return { error: "self" };

    // Existing user → instant active
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

  // Non-registered email → upsert invited row (userId null), issue token
  const rows = await db
    .insert(schema.chatAgents)
    .values({
      projectId,
      userId: null,
      invitedEmail: normalized,
      status: "invited",
    })
    .onConflictDoNothing()
    .returning({
      id: schema.chatAgents.id,
      invitedEmail: schema.chatAgents.invitedEmail,
      status: schema.chatAgents.status,
      createdAt: schema.chatAgents.createdAt,
    });

  // Fetch the row (may already exist from a prior invite)
  const agent = rows[0] ?? (await db
    .select({
      id: schema.chatAgents.id,
      invitedEmail: schema.chatAgents.invitedEmail,
      status: schema.chatAgents.status,
      createdAt: schema.chatAgents.createdAt,
    })
    .from(schema.chatAgents)
    .where(
      and(
        eq(schema.chatAgents.projectId, projectId),
        eq(schema.chatAgents.invitedEmail, normalized),
      ),
    )
    .limit(1)
    .then((r) => r[0]));

  const token = await issueAgentInviteToken(projectId, normalized);
  return { agent, invited: true, token };
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
