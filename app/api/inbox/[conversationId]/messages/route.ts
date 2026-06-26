import { encodeCursor } from "@/lib/chat/cursor";
import { listMessagesSince, markConversationRead, getOtherReadAt } from "@/lib/chat/store";
import { hub } from "@/lib/chat/hub";
import { json, requireOwnerForConversation } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/inbox/[conversationId]/messages?since=<cursor> */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ conversationId: string }> },
): Promise<Response> {
  const { conversationId } = await params;
  const ctx = await requireOwnerForConversation(conversationId);
  if ("error" in ctx) return json({ error: ctx.error === 401 ? "unauthorized" : "not_found" }, ctx.error);

  const since = new URL(req.url).searchParams.get("since");
  const rows = await listMessagesSince(conversationId, since);
  const messages = rows.map((m) => ({
    id: m.id,
    authorId: m.authorId,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
    mine: m.authorId === ctx.ownerChatUserId,
  }));
  const nextCursor =
    rows.length > 0 ? encodeCursor(rows[rows.length - 1]) : (since ?? null);

  // Mark this participant's read position and publish a live read event.
  const selfId = ctx.ownerChatUserId;
  const now = new Date();
  try {
    await markConversationRead(ctx.projectId, conversationId, selfId, now);
    hub.publish(conversationId, { type: "read", userId: selfId, readAt: now.toISOString() });
  } catch { /* non-fatal */ }
  const otherReadAt = await getOtherReadAt(ctx.projectId, conversationId, selfId).catch(() => null);

  return json({ messages, nextCursor, otherReadAt: otherReadAt ? otherReadAt.toISOString() : null }, 200);
}
