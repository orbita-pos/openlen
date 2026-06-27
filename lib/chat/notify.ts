import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { checkAndConsume } from "@/lib/limits";
import { getChatOwner, getChatUserById } from "@/lib/chat/store";
import { listAgentUserIds } from "@/lib/chat/agents";
import { hub } from "@/lib/chat/hub";
import { scheduleNotification } from "@/lib/notifications/dispatch";

const DEBOUNCE_WINDOW_MS = 10 * 60 * 1000;

/** Fire-and-forget: schedules an owner notification (push + email) via the
 *  durable dispatcher when a visitor messages them and they've been idle.
 *  Debounced to 1 notification per 10 min per conversation. All failures are
 *  silenced — the caller wraps this in void + catch. */
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

  // 3. Resolve project (userId) — needed for hub presence check + dispatcher
  const projectRows = await db
    .select({ userId: schema.projects.userId })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  const project = projectRows[0];
  if (!project) return;

  // 4. Presence check: owner OR any active agent has a live Desk SSE connection
  // tracked in the hub. When present, skip the email — someone's handling it.
  if (hub.isProjectStaffOnline(projectId, project.userId, await listAgentUserIds(projectId))) return;

  // 5. Debounce: at most 1 notification per 10 min per conversation
  const { ok } = await checkAndConsume(`chat:notify:${conversationId}`, [
    { windowMs: DEBOUNCE_WINDOW_MS, max: 1, label: "per-conversation" },
  ]);
  if (!ok) return;

  // 5a. Sender name
  const sender = await getChatUserById(senderUserId);
  const senderName = sender?.displayName ?? sender?.username ?? "Someone";

  // 5b. Schedule push + email via the durable dispatcher
  const recipientUserId = project.userId;
  const preview = messageBody.slice(0, 140);
  await scheduleNotification(
    { type: "chat_message", projectId, conversationId, recipientUserId, senderName, preview },
    "chat:" + conversationId,
  );
}
