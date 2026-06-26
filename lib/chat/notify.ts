import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { checkAndConsume } from "@/lib/limits";
import { getChatOwner, getChatUserById } from "@/lib/chat/store";
import { listAgentUserIds } from "@/lib/chat/agents";
import { sendChatNotificationEmail } from "@/lib/email";
import { hub } from "@/lib/chat/hub";

const DEBOUNCE_WINDOW_MS = 10 * 60 * 1000;

/** Fire-and-forget: email the project owner when a visitor messages them and
 *  they've been idle for more than 5 minutes. Debounced to 1 email per 10 min
 *  per conversation to avoid inbox spam. All failures are silenced — the
 *  caller wraps this in void + catch. */
export async function notifyOwnerIfOffline(
  projectId: string,
  conversationId: string,
  senderUserId: string,
  messageBody: string,
): Promise<void> {
  // 1. Load conversation participants scoped to projectId
  const convRows = await db
    .select({
      aUserId: schema.chatConversations.aUserId,
      bUserId: schema.chatConversations.bUserId,
    })
    .from(schema.chatConversations)
    .where(
      and(
        eq(schema.chatConversations.id, conversationId),
        eq(schema.chatConversations.projectId, projectId),
      ),
    )
    .limit(1);
  if (convRows.length === 0) return;
  const { aUserId, bUserId } = convRows[0];

  // 2. Guard: owner must exist + be a participant + not be the sender
  const owner = await getChatOwner(projectId);
  if (!owner) return;
  if (owner.id !== aUserId && owner.id !== bUserId) return;
  if (senderUserId === owner.id) return;

  // 3. Resolve project (userId + title) — needed for hub presence check + email
  const projectRows = await db
    .select({ userId: schema.projects.userId, title: schema.projects.title })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  const project = projectRows[0];
  if (!project) return;
  const projectTitle = project.title ?? projectId;

  // 4. Presence check: owner OR any active agent has a live Desk SSE connection
  // tracked in the hub. When present, skip the email — someone's handling it.
  if (hub.isProjectStaffOnline(projectId, project.userId, await listAgentUserIds(projectId))) return;

  // 5. Debounce: at most 1 notification per 10 min per conversation
  const { ok } = await checkAndConsume(`chat:notify:${conversationId}`, [
    { windowMs: DEBOUNCE_WINDOW_MS, max: 1, label: "per-conversation" },
  ]);
  if (!ok) return;

  // 5a. Prefer owner chat_user.email
  const chatEmailRows = await db
    .select({ email: schema.chatUsers.email })
    .from(schema.chatUsers)
    .where(eq(schema.chatUsers.id, owner.id))
    .limit(1);
  let ownerEmail: string | null = chatEmailRows[0]?.email ?? null;

  // 5b. Fall back to platform user email via project.userId
  if (!ownerEmail && project) {
    const userRows = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, project.userId))
      .limit(1);
    ownerEmail = userRows[0]?.email ?? null;
  }
  if (!ownerEmail) return;

  // 6. Sender name
  const sender = await getChatUserById(senderUserId);
  const senderName = sender?.displayName ?? sender?.username ?? "Someone";

  // 7. Desk URL
  const deskUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://openlen.com"}/inbox`;

  // 8. Send
  await sendChatNotificationEmail({
    to: ownerEmail,
    ownerName: owner.displayName ?? owner.username,
    senderName,
    messageBody,
    deskUrl,
    projectTitle,
  });
}
