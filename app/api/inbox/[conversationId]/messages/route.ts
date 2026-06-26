import { encodeCursor } from "@/lib/chat/cursor";
import { listMessagesSince } from "@/lib/chat/store";
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
  return json({ messages, nextCursor }, 200);
}
