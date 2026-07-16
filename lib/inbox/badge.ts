// Inbox badge counts — the "N nuevos" on the workspace rail.
//   chat  = conversations with visitor messages newer than the owner's last
//           read (reuses the existing aReadAt/bReadAt receipts; one
//           conversation counts once, WhatsApp semantics).
//   leads = form submissions newer than users.lastSeenLeadsAt (null = all).
// Spec: docs/superpowers/specs/2026-07-16-inbox-badge-design.md

import { and, eq, gt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { listAgentProjectIds } from "@/lib/chat/agents";
import { resolveChatUniverse, type ChatUniverseDeps } from "./universe";

export interface InboxBadgeCounts {
  chat: number;
  leads: number;
}

const dbDeps: ChatUniverseDeps = {
  async ownedProjects(userId) {
    const rows = await db
      .select({ id: schema.projects.id, data: schema.projects.data })
      .from(schema.projects)
      .where(eq(schema.projects.userId, userId));
    return rows.map((r) => ({
      id: r.id,
      chatEnabled: r.data?.settings?.chat?.enabled === true,
    }));
  },
  agentProjectIds: listAgentProjectIds,
  async projectChatEnabled(projectId) {
    const rows = await db
      .select({ data: schema.projects.data })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))
      .limit(1);
    if (rows.length === 0) return null;
    return rows[0].data?.settings?.chat?.enabled === true;
  },
};

export async function countInboxBadge(
  userId: string,
): Promise<InboxBadgeCounts> {
  const [leads, chat] = await Promise.all([
    countNewLeads(userId),
    countUnreadChat(userId),
  ]);
  return { chat, leads };
}

async function countNewLeads(userId: string): Promise<number> {
  const userRows = await db
    .select({ lastSeenLeadsAt: schema.users.lastSeenLeadsAt })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  const lastSeen = userRows[0]?.lastSeenLeadsAt ?? null;
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.formSubmissions)
    .innerJoin(
      schema.projects,
      eq(schema.formSubmissions.projectId, schema.projects.id),
    )
    .where(
      and(
        eq(schema.projects.userId, userId),
        lastSeen ? gt(schema.formSubmissions.createdAt, lastSeen) : undefined,
      ),
    );
  return rows[0]?.n ?? 0;
}

async function countUnreadChat(userId: string): Promise<number> {
  const ids = await resolveChatUniverse(userId, dbDeps);
  if (ids.length === 0) return 0;
  const idList = sql.join(ids.map((id) => sql`${id}`), sql`, `);
  // The owner's side of each conversation is the project's role='owner' chat
  // user; owner-authored messages (incl. agents replying AS the business
  // through that same chat user) never count as unread.
  const res = await db.execute(sql`
    SELECT count(DISTINCT c."id")::int AS n
    FROM "chatConversations" c
    JOIN "chatUsers" o
      ON o."projectId" = c."projectId" AND o."role" = 'owner'
    WHERE c."projectId" IN (${idList})
      AND (c."aUserId" = o."id" OR c."bUserId" = o."id")
      AND EXISTS (
        SELECT 1
        FROM "chatMessages" m
        WHERE m."conversationId" = c."id"
          AND m."authorId" <> o."id"
          AND m."createdAt" > COALESCE(
            CASE WHEN c."aUserId" = o."id" THEN c."aReadAt" ELSE c."bReadAt" END,
            '-infinity'::timestamp
          )
      )
  `);
  const row = res.rows[0] as { n?: number } | undefined;
  return Number(row?.n ?? 0);
}
